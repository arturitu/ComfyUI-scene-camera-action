"""
ComfyUI Scene Camera Action Nodes
Custom nodes for 3D scene setup and actor acting within ComfyUI.
"""

from __future__ import annotations
import json
import os
import shutil
import subprocess
from aiohttp import web
from server import PromptServer
import folder_paths

from comfy_api.latest import ComfyExtension, io, InputImpl, Types
from comfy_api.latest._io import _UIOutput
from fractions import Fraction
from typing_extensions import override


class _SceneUIOutput(_UIOutput):
    """Sends scene state to the UI frontend."""

    def __init__(self, scene_dict: dict):
        super().__init__()
        self.scene_dict = scene_dict

    def as_dict(self) -> dict:
        return {"scene_state": self.scene_dict}


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
SceneIO = io.Custom("SCENE")
ActingIO = io.Custom("ACTING")


CUSTOM_NODE_DIR = os.path.dirname(os.path.realpath(__file__))
PRESETS_DIR = os.path.join(CUSTOM_NODE_DIR, "presets")


def get_staging_scene_files() -> list[str]:
    files = set()
    # 1. Scan presets/ inside custom node directory
    if os.path.exists(PRESETS_DIR):
        for f in os.listdir(PRESETS_DIR):
            if f.endswith(".json"):
                files.add(f)

    # 2. Scan input/staging_scenes/ in ComfyUI input directory
    try:
        input_dir = folder_paths.get_input_directory()
        if input_dir:
            scenes_dir = os.path.join(input_dir, "staging_scenes")
            if os.path.exists(scenes_dir):
                for f in os.listdir(scenes_dir):
                    if f.endswith(".json"):
                        files.add(f)
    except Exception:
        pass

    return sorted(list(files)) if files else ["None"]


class SceneNode(io.ComfyNode):
    """
    Scene Node / Staging 3D Node
    Configures a 3D scene environment with multiple adjustable 3D assets (cubes).
    Supports loading preset files, interactive visual editing, and live saving directly inside the 3D widget.
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="SceneNode",
            display_name="Staging 3D Node",
            category="SceneCameraAction",
            is_output_node=False,
            description="Configures a 3D scene environment with multiple assets.",
            inputs=[
                io.String.Input(
                    "scene_data",
                    default="",
                    display_name="Scene Data",
                    tooltip="Serialized JSON data of the scene configurations",
                    optional=True,
                ),
            ],
            outputs=[
                SceneIO.Output("scene_data", display_name="Scene Data"),
            ],
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def execute(
        cls,
        scene_data: str = "",
    ) -> io.NodeOutput:
        scene_dict = {}
        if scene_data.strip():
            try:
                scene_dict = json.loads(scene_data)
            except Exception:
                pass

        if not scene_dict:
            scene_dict = {
                "type": "cube_scene",
                "num_assets": 0,
                "nodes": [],
            }

        scene_json = json.dumps(scene_dict)
        return io.NodeOutput(scene_json, ui=_SceneUIOutput(scene_dict))

    @classmethod
    def fingerprint_inputs(
        cls,
        scene_data: str = "",
    ):
        return f"{scene_data}"


class ActingNode(io.ComfyNode):
    """
    Acting Node
    Receives scene data from a SceneNode and hosts interactive actor acting.
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ActingNode",
            display_name="Acting 3D Node",
            category="SceneCameraAction",
            is_output_node=False,
            description="Receives a 3D scene from SceneNode and hosts interactive actor acting.",
            inputs=[
                SceneIO.Input(
                    "scene",
                    display_name="Scene",
                    tooltip="Scene data connection from a SceneNode",
                    optional=True,
                ),
                io.Combo.Input(
                    "actor_type",
                    options=["human", "car"],
                    default="human",
                    display_name="Actor Type",
                    tooltip="Select between Human (capsule physics) and Car (vehicle physics with inertia)",
                ),
                io.Float.Input(
                    "actor_speed",
                    default=10.0, min=1.0, max=20.0, step=1.0,
                    display_name="Actor Speed",
                    tooltip="Movement speed of the 3D actor",
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
        scene: str | dict | None = None,
        actor_type: str = "human",
        actor_speed: float = 10.0,
        duration: float = 7.0,
        motion_data: str = "",
    ) -> io.NodeOutput:
        scene_data = {}
        if isinstance(scene, str) and scene.strip():
            try:
                scene_data = json.loads(scene)
            except Exception:
                scene_data = {"raw": scene}
        elif isinstance(scene, dict):
            scene_data = scene

        acting_dict = {
            "scene_data": scene_data,
            "actor_type": actor_type,
            "actor_speed": actor_speed,
            "duration": duration,
            "motion_data": motion_data,
        }

        acting_json = json.dumps(acting_dict)
        return io.NodeOutput(acting_json, ui=_ActingUIOutput(acting_dict))


class DirectingNode(io.ComfyNode):
    """
    Directing Node
    Records camera cuts on top of acting motion data and outputs captured video and captured stage overview image.
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="DirectingNode",
            display_name="Directing 3D Node",
            category="SceneCameraAction",
            is_output_node=False,
            description="Records camera cuts on top of acting data, outputs captured video and stage overview image.",
            inputs=[
                ActingIO.Input(
                    "acting",
                    display_name="Acting",
                    tooltip="Acting motion connection from an ActingNode",
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
                io.Video.Output("captured_video", display_name="Captured Video"),
                io.Image.Output("captured_first_frame", display_name="Captured First Frame"),
            ],
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def execute(
        cls,
        acting: str | dict | None = None,
        directing_data: str = "",
    ) -> io.NodeOutput:
        node_id = cls.hidden.unique_id
        input_dir = folder_paths.get_input_directory()

        # 1. Load Video (Prioritize QuickTime-compatible H.264 MP4, fallback to WebM)
        specific_mp4 = f"3d_directing_record_{node_id}.mp4"
        mp4_path = os.path.join(input_dir, specific_mp4)
        if not os.path.exists(mp4_path):
            mp4_path = os.path.join(input_dir, "3d_directing_record.mp4")

        specific_webm = f"3d_directing_record_{node_id}.webm"
        webm_path = os.path.join(input_dir, specific_webm)
        if not os.path.exists(webm_path):
            webm_path = os.path.join(input_dir, "3d_directing_record.webm")

        if not os.path.exists(mp4_path) and os.path.exists(webm_path):
            convert_webm_to_mp4(webm_path, mp4_path)

        video_path = mp4_path if os.path.exists(mp4_path) else webm_path

        video_output = None
        if os.path.exists(video_path):
            try:
                video_output = InputImpl.VideoFromFile(video_path)
            except Exception as e:
                print(f"Error loading video file: {e}")

        if video_output is None:
            import torch
            dummy_images = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
            video_output = InputImpl.VideoFromComponents(
                Types.VideoComponents(images=dummy_images, audio=None, frame_rate=Fraction(24))
            )

        # 2. Load Captured Stage Overview Image (Check node-specific file first, then fallback)
        specific_image = f"3d_directing_stage_{node_id}.png"
        image_path = os.path.join(input_dir, specific_image)
        if not os.path.exists(image_path):
            image_path = os.path.join(input_dir, "3d_directing_stage.png")

        image_tensor = None
        if os.path.exists(image_path):
            try:
                from PIL import Image, ImageOps
                import numpy as np
                import torch

                i = Image.open(image_path)
                i = ImageOps.exif_transpose(i)
                image = i.convert("RGB")
                image_np = np.array(image).astype(np.float32) / 255.0
                image_tensor = torch.from_numpy(image_np)[None,]
            except Exception as e:
                print(f"Error loading stage image file: {e}")

        if image_tensor is None:
            import torch
            image_tensor = torch.zeros((1, 64, 64, 3), dtype=torch.float32)

        acting_data = {}
        if isinstance(acting, str) and acting.strip():
            try:
                acting_data = json.loads(acting)
            except Exception:
                acting_data = {"raw": acting}
        elif isinstance(acting, dict):
            acting_data = acting

        scene_data = acting_data.get("scene_data", {})

        camera_timeline = []
        if directing_data and directing_data.strip():
            try:
                camera_timeline = json.loads(directing_data)
            except Exception:
                camera_timeline = []

        directing_dict = {
            "scene_data": scene_data,
            "acting_data": acting_data,
            "directing_data": camera_timeline,
        }

        return io.NodeOutput(video_output, image_tensor, ui=_DirectingUIOutput(directing_dict))

    @classmethod
    def fingerprint_inputs(
        cls,
        acting=None,
        directing_data: str = "",
    ):
        node_id = cls.hidden.unique_id
        input_dir = folder_paths.get_input_directory()
        mtime = 0.0

        for candidate in [f"3d_directing_record_{node_id}.mp4", f"3d_directing_record_{node_id}.webm", f"3d_directing_stage_{node_id}.png"]:
            path = os.path.join(input_dir, candidate)
            if os.path.exists(path):
                mtime = max(mtime, os.path.getmtime(path))

        return f"{acting}_{directing_data}_{mtime}"


class SceneCameraActionExtension(ComfyExtension):
    @override
    async def get_node_list(self):
        return [SceneNode, ActingNode, DirectingNode]


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
@PromptServer.instance.routes.post("/scene_camera_action/upload_video")
async def upload_video(request):
    post = await request.post()
    video_file = post.get("video")
    custom_filename = post.get("filename")

    if video_file:
        input_dir = folder_paths.get_input_directory()
        filename = os.path.basename(custom_filename) if custom_filename else "3d_directing_record.webm"
        filepath = os.path.join(input_dir, filename)

        with open(filepath, "wb") as f:
            f.write(video_file.file.read())

        # Automatically convert WebM to QuickTime-compatible H.264 MP4
        base_name, _ = os.path.splitext(filename)
        mp4_filename = f"{base_name}.mp4"
        mp4_filepath = os.path.join(input_dir, mp4_filename)

        success_mp4 = convert_webm_to_mp4(filepath, mp4_filepath)
        final_filename = mp4_filename if success_mp4 else filename
        final_filepath = mp4_filepath if success_mp4 else filepath

        return web.json_response({"success": True, "filepath": final_filepath, "filename": final_filename})
    return web.json_response({"success": False, "error": "No video file received"})


@PromptServer.instance.routes.post("/scene_camera_action/upload_image")
async def upload_image(request):
    post = await request.post()
    image_file = post.get("image")
    custom_filename = post.get("filename")

    if image_file:
        input_dir = folder_paths.get_input_directory()
        filename = os.path.basename(custom_filename) if custom_filename else "3d_directing_stage.png"
        filepath = os.path.join(input_dir, filename)

        with open(filepath, "wb") as f:
            f.write(image_file.file.read())

        return web.json_response({"success": True, "filepath": filepath, "filename": filename})
    return web.json_response({"success": False, "error": "No image file received"})


@PromptServer.instance.routes.get("/scene_camera_action/list_presets")
async def list_presets(request):
    files = get_staging_scene_files()
    return web.json_response({"files": files})


@PromptServer.instance.routes.get("/scene_camera_action/get_preset")
async def get_preset(request):
    filename = request.query.get("filename", "")
    if not filename or filename == "None":
        return web.json_response({"type": "cube_scene", "nodes": []})

    filepath = os.path.join(PRESETS_DIR, filename)
    if not os.path.exists(filepath):
        try:
            input_dir = folder_paths.get_input_directory()
            filepath = os.path.join(input_dir, "staging_scenes", filename)
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


@PromptServer.instance.routes.post("/scene_camera_action/save_preset")
async def save_preset(request):
    try:
        body = await request.json()
        filename = body.get("filename", "")
        scene_data = body.get("scene_data", {})

        if not filename or filename == "None":
            filename = "nueva_escena.json"
        if not filename.endswith(".json"):
            filename += ".json"

        os.makedirs(PRESETS_DIR, exist_ok=True)
        filepath = os.path.join(PRESETS_DIR, filename)

        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(scene_data, f, indent=2)

        return web.json_response({"success": True, "filename": filename, "filepath": filepath})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


async def comfy_entrypoint():
    return SceneCameraActionExtension()


NODE_CLASS_MAPPINGS = {
    "SceneNode": SceneNode,
    "ActingNode": ActingNode,
    "DirectingNode": DirectingNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "SceneNode": "Staging 3D Node",
    "ActingNode": "Acting 3D Node",
    "DirectingNode": "Directing 3D Node",
}

