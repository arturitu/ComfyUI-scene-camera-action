"""
Unboring 3D Studio Nodes (ComfyUI-UB-3D-Studio)
Interactive 3D scene staging, actor acting, and camera directing nodes for ComfyUI.
"""

from __future__ import annotations
import json
import os
import shutil
import subprocess
from aiohttp import web
from server import PromptServer
import folder_paths

from comfy_api.latest import ComfyExtension, io, InputImpl
from comfy_api.latest._io import _UIOutput
from typing_extensions import override
import threading
import time

_pending_captures: dict[str, threading.Event] = {}
_capture_results: dict[str, dict] = {}



class _StageUIOutput(_UIOutput):
    """Sends stage state to the UI frontend."""

    def __init__(self, stage_dict: dict):
        super().__init__()
        self.stage_dict = stage_dict

    def as_dict(self) -> dict:
        return {"stage_state": self.stage_dict}


class _ActingUIOutput(_UIOutput):
    """Sends acting state to the UI frontend."""

    def __init__(self, acting_dict: dict):
        super().__init__()
        self.acting_dict = acting_dict

    def as_dict(self) -> dict:
        return {"acting_state": self.acting_dict}


class _DirectingUIOutput(_UIOutput):
    """Sends directing state to the UI frontend."""

    def __init__(self, directing_dict: dict):
        super().__init__()
        self.directing_dict = directing_dict

    def as_dict(self) -> dict:
        return {"directing_state": self.directing_dict}


# Custom IO types for node connections
StageIO = io.Custom("*")
ActingIO = io.Custom("*")


CUSTOM_NODE_DIR = os.path.dirname(os.path.realpath(__file__))
PRESETS_DIR = os.path.join(CUSTOM_NODE_DIR, "presets")


def get_staging_stage_files() -> list[str]:
    files = set()
    # 1. Scan presets/ inside custom node directory
    if os.path.exists(PRESETS_DIR):
        for f in os.listdir(PRESETS_DIR):
            if f.lower().endswith((".json", ".glb", ".gltf")):
                files.add(f)

    # 2. Scan input/staging_stages/ in ComfyUI input directory
    try:
        input_dir = folder_paths.get_input_directory()
        if input_dir:
            stages_dir = os.path.join(input_dir, "staging_stages")
            if os.path.exists(stages_dir):
                for f in os.listdir(stages_dir):
                    if f.lower().endswith((".json", ".glb", ".gltf")):
                        files.add(f)
    except Exception:
        pass

    return sorted(list(files)) if files else ["None"]


def get_staging_glb_files() -> list[str]:
    files = set()
    # 1. Scan presets/ inside custom node directory
    if os.path.exists(PRESETS_DIR):
        for f in os.listdir(PRESETS_DIR):
            if f.lower().endswith((".glb", ".gltf")):
                files.add(f)

    # 2. Scan input/staging_stages/ in ComfyUI input directory
    try:
        input_dir = folder_paths.get_input_directory()
        if input_dir:
            stages_dir = os.path.join(input_dir, "staging_stages")
            if os.path.exists(stages_dir):
                for f in os.listdir(stages_dir):
                    if f.lower().endswith((".glb", ".gltf")):
                        files.add(f)
    except Exception:
        pass

    return sorted(list(files)) if files else ["None"]


class StagingNode(io.ComfyNode):
    CATEGORY = "scene-camera-action"

    """
    Staging Node
    Configures a 3D stage environment with multiple adjustable 3D assets (cubes).
    Supports loading preset files, interactive visual editing, and live saving directly inside the 3D widget.
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="StagingNode",
            display_name="Staging",
            category="scene-camera-action",
            is_output_node=False,
            description="Configures a 3D stage environment with multiple assets.",
            inputs=[
                io.String.Input(
                    "stage_data",
                    default="",
                    display_name="Stage Data",
                    tooltip="Serialized JSON data of the stage configurations",
                    optional=True,
                ),
            ],
            outputs=[
                StageIO.Output("stage_data", display_name="Stage Data"),
            ],
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def execute(
        cls,
        stage_data: str = "",
    ) -> io.NodeOutput:
        stage_dict = {}
        if stage_data.strip():
            try:
                stage_dict = json.loads(stage_data)
            except Exception:
                pass

        if not stage_dict:
            stage_dict = {
                "type": "cube_stage",
                "num_assets": 0,
                "nodes": [],
            }

        stage_json = json.dumps(stage_dict)
        return io.NodeOutput(stage_json, ui=_StageUIOutput(stage_dict))

    @classmethod
    def fingerprint_inputs(
        cls,
        stage_data: str = "",
    ):
        return f"{stage_data}"


class StagingGLBNode(io.ComfyNode):
    CATEGORY = "scene-camera-action"

    """
    Staging (GLB) Node
    Loads an arbitrary 3D clay environment from a .glb/.gltf file for acting and directing.
    Outputs standard StageIO data compatible with ActingNode and DirectingNode.
    """

    @classmethod
    def define_schema(cls):
        glb_options = get_staging_glb_files()
        default_file = glb_options[0] if glb_options else "None"
        return io.Schema(
            node_id="StagingGLBNode",
            display_name="Staging (GLB)",
            category="scene-camera-action",
            is_output_node=False,
            description="Loads an arbitrary 3D clay environment from a .glb/.gltf file for acting and directing.",
            inputs=[
                io.Combo.Input(
                    "glb_file",
                    options=glb_options,
                    default=default_file,
                    display_name="GLB Stage File",
                    tooltip="Select a .glb clay stage from presets/ or input/staging_stages/",
                ),
                io.Float.Input(
                    "stage_scale",
                    default=1.0, min=0.01, max=10.0, step=0.05,
                    display_name="Stage Scale",
                    tooltip="Metric scale multiplier for the imported stage",
                ),
                io.Float.Input(
                    "offset_y",
                    default=0.0, min=-50.0, max=50.0, step=0.1,
                    display_name="Vertical Offset (Y)",
                    tooltip="Adjust vertical ground elevation in meters",
                ),
                io.Float.Input(
                    "rotation_y",
                    default=0.0, min=-180.0, max=180.0, step=1.0,
                    display_name="Rotation Y (deg)",
                    tooltip="Yaw rotation of the stage in degrees",
                ),
            ],
            outputs=[
                StageIO.Output("stage_data", display_name="Stage Data"),
            ],
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def execute(
        cls,
        glb_file: str = "None",
        stage_scale: float = 1.0,
        offset_y: float = 0.0,
        rotation_y: float = 0.0,
    ) -> io.NodeOutput:
        glb_name = str(glb_file).strip() if glb_file else "None"
        glb_url = f"/scene_camera_action/get_glb?filename={glb_name}" if glb_name and glb_name != "None" else ""
        stage_dict = {
            "type": "glb_stage",
            "glb_path": glb_name,
            "glb_url": glb_url,
            "stage_scale": float(stage_scale),
            "offset": [0.0, float(offset_y), 0.0],
            "rotation_y": float(rotation_y),
            "selectedPreset": glb_name,
        }
        stage_json = json.dumps(stage_dict)
        return io.NodeOutput(stage_json, ui=_StageUIOutput(stage_dict))

    @classmethod
    def fingerprint_inputs(
        cls,
        glb_file: str = "None",
        stage_scale: float = 1.0,
        offset_y: float = 0.0,
        rotation_y: float = 0.0,
    ):
        return f"{glb_file}_{stage_scale}_{offset_y}_{rotation_y}"


class ActingNode(io.ComfyNode):
    CATEGORY = "scene-camera-action"

    """
    Acting Node
    Receives stage data from a Staging node or acting data from a previous Acting node,
    and hosts interactive actor acting.
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ActingNode",
            display_name="Acting",
            category="scene-camera-action",
            is_output_node=False,
            description="Receives a 3D stage from Staging or acting data from a previous Acting node, hosting interactive actor acting.",
            inputs=[
                StageIO.Input(
                    "stage",
                    display_name="Stage / Acting",
                    tooltip="Connect a Staging node or previous Acting node for multi-actor chaining",
                    optional=True,
                ),
                io.Combo.Input(
                    "actor_type",
                    options=["human", "car", "quadruped"],
                    default="human",
                    display_name="Actor Type",
                    tooltip="Select between Human, Car, and Quadruped",
                ),
                io.Float.Input(
                    "actor_speed",
                    default=10.0, min=1.0, max=30.0, step=1.0,
                    display_name="Actor Speed",
                    tooltip="Movement speed of the 3D actor",
                ),
                io.Float.Input(
                    "actor_scale",
                    default=1.0, min=0.3, max=2.0, step=0.05,
                    display_name="Actor Scale",
                    tooltip="Scale factor for the 3D actor (0.3 to 2.0)",
                ),
                io.Color.Input(
                    "actor_color",
                    default="#F1DFBF",
                    display_name="Actor Color",
                    tooltip="Color for the 3D actor mesh",
                    optional=True,
                ),
                io.Float.Input(
                    "duration",
                    default=7.0, min=4.0, max=15.0, step=1.0,
                    display_name="Duration (s)",
                    tooltip="Recording duration in seconds",
                ),
                io.String.Input(
                    "motion_data",
                    default="",
                    display_name="Motion Data",
                    tooltip="Serialized JSON recording of actor acting (hidden)",
                    optional=True,
                ),
            ],
            outputs=[
                ActingIO.Output("acting_data", display_name="Acting Data"),
            ],
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def execute(
        cls,
        stage: str | dict | None = None,
        actor_type: str = "human",
        actor_speed: float = 10.0,
        actor_scale: float = 1.0,
        actor_color: str | dict | None = "#F1DFBF",
        duration: float = 7.0,
        motion_data: str = "",
    ) -> io.NodeOutput:
        try:
            actor_scale = float(actor_scale)
            actor_scale = max(0.3, min(2.0, actor_scale))
        except (ValueError, TypeError):
            actor_scale = 0.5 if actor_type == "quadruped" else 1.0

        default_c = "#0284C7" if actor_type == "car" else "#F1DFBF"
        def sanitize_color(val: str | dict | None) -> str:
            if isinstance(val, str) and val.strip():
                s = val.strip()
                if s.startswith("{") or s.startswith("[") or '"type"' in s:
                    return default_c
                if not s.startswith("#") and len(s) in (3, 6, 8):
                    s = f"#{s}"
                if s.startswith("#"):
                    if len(s) == 9:
                        return s[:7]
            elif isinstance(val, dict):
                hex_val = val.get("hex") or val.get("color")
                if isinstance(hex_val, str) and hex_val.startswith("#"):
                    return hex_val[:7] if len(hex_val) == 9 else hex_val
            return default_c

        clean_color = sanitize_color(actor_color)

        stage_input_data = {}
        if isinstance(stage, str) and stage.strip():
            try:
                stage_input_data = json.loads(stage)
            except Exception:
                stage_input_data = {"raw": stage}
        elif isinstance(stage, dict):
            stage_input_data = stage

        stage_data = {}
        previous_actors = []

        if "nodes" in stage_input_data or "type" in stage_input_data:
            stage_data = stage_input_data
        elif "stage_data" in stage_input_data or "actors" in stage_input_data:
            stage_data = stage_input_data.get("stage_data", {})
            if "duration" in stage_input_data:
                try:
                    duration = float(stage_input_data["duration"])
                except (ValueError, TypeError):
                    pass

            if isinstance(stage_input_data.get("actors"), list):
                previous_actors = []
                for act in stage_input_data["actors"]:
                    if isinstance(act, dict):
                        act_copy = dict(act)
                        if "actor_scale" not in act_copy:
                            act_copy["actor_scale"] = 0.5 if act_copy.get("actor_type") == "quadruped" else 1.0
                        previous_actors.append(act_copy)
            elif stage_input_data.get("motion_data") or stage_input_data.get("trajectory"):
                traj = stage_input_data.get("trajectory")
                if not traj and isinstance(stage_input_data.get("motion_data"), str) and stage_input_data["motion_data"].strip():
                    try:
                        parsed_m = json.loads(stage_input_data["motion_data"])
                        traj = parsed_m.get("trajectory", []) if isinstance(parsed_m, dict) else []
                    except Exception:
                        traj = []
                if not traj and isinstance(stage_input_data.get("motion_data"), list):
                    traj = stage_input_data["motion_data"]

                previous_actors = [{
                    "id": "actor_1",
                    "actor_type": stage_input_data.get("actor_type", "human"),
                    "actor_color": sanitize_color(stage_input_data.get("actor_color")),
                    "actor_speed": stage_input_data.get("actor_speed", 10.0),
                    "actor_scale": stage_input_data.get("actor_scale", 0.5 if stage_input_data.get("actor_type") == "quadruped" else 1.0),
                    "spawn_point": stage_input_data.get("spawn_point"),
                    "trajectory": traj or []
                }]

        # Parse current actor trajectory from motion_data
        current_traj = []
        current_spawn = None
        if motion_data and isinstance(motion_data, str) and motion_data.strip():
            try:
                parsed_curr = json.loads(motion_data)
                if isinstance(parsed_curr, dict):
                    current_traj = parsed_curr.get("trajectory", [])
                    current_spawn = parsed_curr.get("spawn_point")
                elif isinstance(parsed_curr, list):
                    current_traj = parsed_curr
            except Exception:
                pass

        all_actors = list(previous_actors)
        if current_traj:
            current_actor_record = {
                "id": f"actor_{len(previous_actors) + 1}",
                "actor_type": actor_type,
                "actor_color": clean_color,
                "actor_speed": actor_speed,
                "actor_scale": actor_scale,
                "spawn_point": current_spawn,
                "trajectory": current_traj,
            }
            all_actors.append(current_actor_record)

        acting_dict = {
            "stage_data": stage_data,
            "actor_type": actor_type,
            "actor_color": clean_color,
            "actor_speed": actor_speed,
            "actor_scale": actor_scale,
            "duration": duration,
            "motion_data": motion_data,
            "actors": all_actors,
        }

        acting_json = json.dumps(acting_dict)
        return io.NodeOutput(acting_json, ui=_ActingUIOutput(acting_dict))


class DirectingNode(io.ComfyNode):
    CATEGORY = "scene-camera-action"

    """
    Directing Node
    Records camera cuts on top of acting motion data and outputs captured video.
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="DirectingNode",
            display_name="Directing",
            category="scene-camera-action",
            is_output_node=False,
            description="Records camera cuts on top of acting data, outputs captured video.",
            inputs=[
                ActingIO.Input(
                    "acting",
                    display_name="Acting",
                    tooltip="Acting motion connection from an Acting node",
                    optional=True,
                ),
                io.String.Input(
                    "directing_data",
                    default="",
                    display_name="Directing Data",
                    tooltip="Serialized camera cut timeline (managed internally)",
                    optional=True,
                ),
            ],
            outputs=[
                io.Video.Output("video", display_name="Captured Video"),
            ],
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def execute(
        cls,
        acting: str | dict | None = None,
        directing_data: str = "",
    ) -> io.NodeOutput:
        node_id = str(cls.hidden.unique_id)
        input_dir = folder_paths.get_input_directory()

        acting_data = {}
        if isinstance(acting, str) and acting.strip():
            try:
                acting_data = json.loads(acting)
            except Exception:
                acting_data = {"raw": acting}
        elif isinstance(acting, dict):
            acting_data = acting

        # 1. Validate acting motion data before attempting capture
        has_motion = False
        if isinstance(acting_data, dict):
            if acting_data.get("trajectory") or acting_data.get("motion_data"):
                has_motion = True
            actors = acting_data.get("actors")
            if isinstance(actors, list) and len(actors) > 0:
                for act in actors:
                    if act.get("trajectory") and len(act["trajectory"]) > 0:
                        has_motion = True
                        break

        if not has_motion:
            raise ValueError("Directing: Directing canvas is disabled. Connect an Acting node and record motion first.")

        # 2. Trigger auto-capture on frontend via WebSocket signal
        _capture_results.pop(node_id, None)
        evt = threading.Event()
        _pending_captures[node_id] = evt
        try:
            PromptServer.instance.send_sync("scene_camera_action_directing_capture", {"node_id": node_id})
            # Wait for frontend to record and upload video (max 40 seconds)
            evt.wait(timeout=40.0)
        except Exception as e:
            print(f"[DirectingNode] Error waiting for frontend capture: {e}")
        finally:
            _pending_captures.pop(node_id, None)

        res = _capture_results.pop(node_id, {})
        if res.get("error"):
            raise ValueError(f"Directing: {res['error']}")

        # 3. Load Node-Specific Video File (No global fallback to old temp files)
        specific_mp4 = f"3d_directing_record_{node_id}.mp4"
        mp4_path = os.path.join(input_dir, specific_mp4)
        specific_webm = f"3d_directing_record_{node_id}.webm"
        webm_path = os.path.join(input_dir, specific_webm)

        if not os.path.exists(mp4_path) and os.path.exists(webm_path):
            convert_webm_to_mp4(webm_path, mp4_path)

        video_path = mp4_path if os.path.exists(mp4_path) else webm_path

        if not os.path.exists(video_path):
            raise ValueError("Directing: No video file was generated. Please ensure active motion recording in Acting.")

        try:
            video_output = InputImpl.VideoFromFile(video_path)
        except Exception as e:
            raise ValueError(f"Directing: Error reading recorded video file: {e}")

        stage_data = acting_data.get("stage_data", acting_data.get("scene_data", {}))

        camera_timeline = []
        if directing_data and directing_data.strip():
            try:
                camera_timeline = json.loads(directing_data)
            except Exception:
                camera_timeline = []

        directing_dict = {
            "stage_data": stage_data,
            "acting_data": acting_data,
            "directing_data": camera_timeline,
        }

        return io.NodeOutput(video_output, ui=_DirectingUIOutput(directing_dict))



    @classmethod
    def fingerprint_inputs(
        cls,
        acting=None,
        directing_data: str = "",
    ):
        return time.time()



class SceneCameraActionExtension(ComfyExtension):
    @override
    async def get_node_list(self):
        return [StagingNode, StagingGLBNode, ActingNode, DirectingNode]


def convert_webm_to_mp4(webm_path: str, mp4_path: str) -> bool:
    """
    Converts WebM video to a QuickTime-compatible MP4 (H.264, YUV420P, faststart).
    QuickTime Player on macOS requires H.264 with yuv420p pixel format and even dimensions.
    """
    ffmpeg_bin = shutil.which("ffmpeg")
    if not ffmpeg_bin:
        for fallback in ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"]:
            if os.path.exists(fallback):
                ffmpeg_bin = fallback
                break

    if not ffmpeg_bin:
        print("[SceneCameraAction] ffmpeg not found, skipping MP4 conversion")
        return False

    cmd = [
        ffmpeg_bin, "-y",
        "-i", webm_path,
        "-c:v", "libx264",
        "-crf", "17",
        "-pix_fmt", "yuv420p",
        "-profile:v", "main",
        "-level", "4.0",
        "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2",
        "-preset", "fast",
        "-movflags", "+faststart",
        mp4_path
    ]
    try:
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=60)
        if res.returncode == 0 and os.path.exists(mp4_path) and os.path.getsize(mp4_path) > 0:
            print(f"[SceneCameraAction] Successfully converted {webm_path} -> {mp4_path} (QuickTime H.264/yuv420p)")
            return True
        else:
            print(f"[SceneCameraAction] ffmpeg conversion warning: {res.stderr}")
            return False
    except Exception as e:
        print(f"[SceneCameraAction] Error running ffmpeg: {e}")
        return False


# --- API Routes to receive video, image uploads, and scene presets ---
try:
    routes = PromptServer.instance.routes
except Exception:
    class _DummyRoutes:
        def post(self, *args, **kwargs):
            def decorator(f):
                return f
            return decorator

        def get(self, *args, **kwargs):
            def decorator(f):
                return f
            return decorator

    routes = _DummyRoutes()


@routes.post("/scene_camera_action/upload_video")
@routes.post("/ub_3d_studio/upload_video")
async def upload_video(request):
    try:
        post = await request.post()
        video_file = post.get("video")
        custom_filename = post.get("filename")

        if video_file:
            input_dir = folder_paths.get_input_directory()
            filename = os.path.basename(custom_filename) if isinstance(custom_filename, str) and custom_filename else "3d_directing_record.webm"
            filepath = os.path.join(input_dir, filename)

            if os.path.exists(filepath):
                try:
                    os.remove(filepath)
                except Exception:
                    pass

            file_bytes = video_file.file.read() if hasattr(video_file, "file") else video_file
            try:
                with open(filepath, "wb") as f:
                    f.write(file_bytes)
            except Exception:
                timestamp = int(time.time())
                base, ext = os.path.splitext(filename)
                filename = f"{base}_{timestamp}{ext}"
                filepath = os.path.join(input_dir, filename)
                with open(filepath, "wb") as f:
                    f.write(file_bytes)

            # Automatically convert WebM to QuickTime-compatible H.264 MP4
            base_name, _ = os.path.splitext(filename)
            mp4_filename = f"{base_name}.mp4"
            mp4_filepath = os.path.join(input_dir, mp4_filename)

            if os.path.exists(mp4_filepath):
                try:
                    os.remove(mp4_filepath)
                except Exception:
                    pass

            success_mp4 = convert_webm_to_mp4(filepath, mp4_filepath)
            final_filename = mp4_filename if success_mp4 else filename
            final_filepath = mp4_filepath if success_mp4 else filepath

            return web.json_response({"success": True, "filepath": final_filepath, "filename": final_filename})
        return web.json_response({"success": False, "error": "No video file received"})
    except Exception as e:
        print(f"[SceneCameraAction] Error uploading video: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@routes.post("/scene_camera_action/upload_image")
@routes.post("/ub_3d_studio/upload_image")
async def upload_image(request):
    try:
        post = await request.post()
        image_file = post.get("image")
        custom_filename = post.get("filename")

        if image_file:
            input_dir = folder_paths.get_input_directory()
            filename = os.path.basename(custom_filename) if isinstance(custom_filename, str) and custom_filename else "3d_directing_stage.png"
            filepath = os.path.join(input_dir, filename)

            if os.path.exists(filepath):
                try:
                    os.remove(filepath)
                except Exception:
                    pass

            file_bytes = image_file.file.read() if hasattr(image_file, "file") else image_file
            try:
                with open(filepath, "wb") as f:
                    f.write(file_bytes)
            except Exception:
                timestamp = int(time.time())
                base, ext = os.path.splitext(filename)
                filename = f"{base}_{timestamp}{ext}"
                filepath = os.path.join(input_dir, filename)
                with open(filepath, "wb") as f:
                    f.write(file_bytes)

            return web.json_response({"success": True, "filepath": filepath, "filename": filename})
        return web.json_response({"success": False, "error": "No image file received"})
    except Exception as e:
        print(f"[SceneCameraAction] Error uploading image: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@routes.get("/scene_camera_action/list_presets")
@routes.get("/ub_3d_studio/list_presets")
async def list_presets(request):
    files = get_staging_stage_files()
    return web.json_response({"files": files})


@routes.get("/scene_camera_action/get_preset")
@routes.get("/ub_3d_studio/get_preset")
async def get_preset(request):
    filename = request.query.get("filename", "")
    if not filename or filename == "None":
        return web.json_response({"type": "cube_stage", "nodes": []})

    filename = os.path.basename(filename)
    if filename.lower().endswith((".glb", ".gltf")):
        return web.json_response({
            "type": "glb_stage",
            "glb_path": filename,
            "glb_url": f"/scene_camera_action/get_glb?filename={filename}",
            "stage_scale": 1.0,
            "offset": [0.0, 0.0, 0.0],
            "rotation_y": 0.0,
            "selectedPreset": filename,
        })

    filepath = os.path.join(PRESETS_DIR, filename)
    if not os.path.exists(filepath):
        try:
            input_dir = folder_paths.get_input_directory()
            if input_dir:
                filepath = os.path.join(input_dir, "staging_stages", filename)
        except Exception:
            pass

    if os.path.exists(filepath):
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
            return web.json_response(data)
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    return web.json_response({"error": "File not found"}, status=404)


@routes.get("/scene_camera_action/get_glb")
@routes.get("/ub_3d_studio/get_glb")
async def get_glb(request):
    filename = request.query.get("filename", "")
    if not filename or filename == "None":
        return web.json_response({"error": "No file specified"}, status=400)

    filename = os.path.basename(filename)
    filepath = os.path.join(PRESETS_DIR, filename)
    if not os.path.exists(filepath):
        try:
            input_dir = folder_paths.get_input_directory()
            if input_dir:
                filepath = os.path.join(input_dir, "staging_stages", filename)
        except Exception:
            pass

    if os.path.exists(filepath) and filename.lower().endswith((".glb", ".gltf")):
        return web.FileResponse(filepath)

    return web.json_response({"error": f"GLB file '{filename}' not found"}, status=404)


@routes.post("/scene_camera_action/save_preset")
@routes.post("/ub_3d_studio/save_preset")
async def save_preset(request):
    try:
        body = await request.json()
        filename = body.get("filename", "")
        stage_data = body.get("stage_data", body.get("scene_data", {}))

        if not filename or filename == "None":
            filename = "nueva_escena.json"
        filename = os.path.basename(filename)
        if not filename.endswith(".json"):
            filename += ".json"

        os.makedirs(PRESETS_DIR, exist_ok=True)
        filepath = os.path.join(PRESETS_DIR, filename)

        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(stage_data, f, indent=2)

        return web.json_response({"success": True, "filename": filename, "filepath": filepath})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


@routes.post("/scene_camera_action/capture_done")
@routes.post("/ub_3d_studio/capture_done")
async def capture_done(request):
    try:
        body = await request.json()
        node_id = str(body.get("node_id", ""))
        if node_id:
            _capture_results[node_id] = body
        if node_id in _pending_captures:
            _pending_captures[node_id].set()
        return web.json_response({"success": True})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)



async def comfy_entrypoint():
    return SceneCameraActionExtension()


NODE_CLASS_MAPPINGS = {
    "StagingNode": StagingNode,
    "StagingGLBNode": StagingGLBNode,
    "ActingNode": ActingNode,
    "DirectingNode": DirectingNode,
    "UBStagingNode": StagingNode,
    "UBStagingGLBNode": StagingGLBNode,
    "UBActingNode": ActingNode,
    "UBDirectingNode": DirectingNode,
    "StageNode": StagingNode,
    "SceneNode": StagingNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "StagingNode": "Staging",
    "StagingGLBNode": "Staging (GLB)",
    "ActingNode": "Acting",
    "DirectingNode": "Directing",
    "UBStagingNode": "Staging",
    "UBStagingGLBNode": "Staging (GLB)",
    "UBActingNode": "Acting",
    "UBDirectingNode": "Directing",
    "StageNode": "Staging",
    "SceneNode": "Staging",
}

