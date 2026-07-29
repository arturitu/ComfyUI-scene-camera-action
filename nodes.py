"""
ComfyUI Scene Camera Action Nodes
Custom nodes for 3D scene setup and character acting within ComfyUI.
"""

from __future__ import annotations
import json
import os
import re
from aiohttp import web
from server import PromptServer
import folder_paths

from comfy_api.latest import ComfyExtension, io, InputImpl, Types
from comfy_api.latest._io import _UIOutput
from fractions import Fraction
from typing import Any
from typing_extensions import override


IMG2BLOCKOUT_SYSTEM_PROMPT = """You are a 3D Scene Architect. Convert the image or description into a clean 3D blockout scene built strictly using transformed BoxGeometry primitives.

CRITICAL RULE: Every single object (ground, walls, roof, pillars, furniture, props) MUST be a box primitive.
CRITICAL FORMATTING RULE: Do NOT wrap the JSON in markdown code blocks (do NOT use ```json or ```). Return ONLY raw valid JSON starting with { and ending with } without any extra conversational text:

{
  "boxes": [
    {
      "name": "Floor Base",
      "position": [0, -0.1, 0],
      "scale": [10, 0.2, 10],
      "rotation": [0, 0, 0]
    },
    {
      "name": "Left Wall",
      "position": [-4, 2, 0],
      "scale": [0.3, 4, 10],
      "rotation": [0, 0, 0]
    }
  ]
}
Note:
- position: [x, y, z] float numbers in 3D space.
- scale: [width, height, depth] float numbers.
- rotation: [rx, ry, rz] Euler angles in radians (usually [0, 0, 0]).
- Keep the total number of boxes between 3 and 20 for visual clarity.
"""



def parse_llm_blockout_json(text: Any) -> list[dict]:
    """Extract asset_transforms from LLM response text or object."""
    if text is None:
        return []

    if isinstance(text, (list, tuple)):
        if len(text) > 0:
            text = text[0]

    print(f"[BlockoutDebug] parse_llm_blockout_json input type: {type(text)}, snippet: {str(text)[:150]}", flush=True)

    data = None
    if isinstance(text, dict):
        data = text
    else:
        text_str = str(text).strip()
        if not text_str:
            return []

        # Find the outermost '{' and '}'
        first_brace = text_str.find("{")
        last_brace = text_str.rfind("}")

        if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
            json_candidate = text_str[first_brace : last_brace + 1]
            try:
                data = json.loads(json_candidate)
            except Exception as e:
                print(f"[BlockoutDebug] JSON parse error: {e}", flush=True)
                data = None

        if data is None:
            try:
                data = json.loads(text_str)
            except Exception:
                data = None

    if not isinstance(data, dict):
        print(f"[BlockoutDebug] Failed to parse JSON dictionary from LLM response: {type(data)}", flush=True)
        return []

    boxes = data.get("boxes", [])
    if not isinstance(boxes, list):
        print(f"[BlockoutDebug] JSON dictionary missing 'boxes' array: {data}", flush=True)
        return []

    asset_transforms = []
    for b in boxes:
        if not isinstance(b, dict):
            continue
        pos = b.get("position", [0, 0, 0])
        scale = b.get("scale", [1, 1, 1])
        rot = b.get("rotation", [0, 0, 0])

        if not (isinstance(pos, list) and len(pos) >= 3):
            pos = [0, 0, 0]
        if not (isinstance(scale, list) and len(scale) >= 3):
            scale = [1, 1, 1]
        if not (isinstance(rot, list) and len(rot) >= 3):
            rot = [0, 0, 0]

        try:
            asset_transforms.append({
                "px": float(pos[0]),
                "py": float(pos[1]),
                "pz": float(pos[2]),
                "rx": float(rot[0]),
                "ry": float(rot[1]),
                "rz": float(rot[2]),
                "sx": float(scale[0]),
                "sy": float(scale[1]),
                "sz": float(scale[2]),
            })
        except Exception as e:
            print(f"[BlockoutDebug] Error parsing box transform: {e}", flush=True)
            continue

    print(f"[BlockoutDebug] Successfully parsed {len(asset_transforms)} box transforms!", flush=True)
    return asset_transforms


class _SceneUIOutput(_UIOutput):
    """Sends scene state to the UI frontend."""

    def __init__(self, scene_dict: dict):
        super().__init__()
        self.scene_dict = scene_dict

    def as_dict(self) -> dict:
        return {"scene_state": [self.scene_dict]}


class _ActingUIOutput(_UIOutput):
    """Sends acting state to the UI frontend."""

    def __init__(self, acting_dict: dict):
        super().__init__()
        self.acting_dict = acting_dict

    def as_dict(self) -> dict:
        return {"acting_state": [self.acting_dict]}


class _DirectingUIOutput(_UIOutput):
    """Sends directing state to the UI frontend."""

    def __init__(self, directing_dict: dict):
        super().__init__()
        self.directing_dict = directing_dict

    def as_dict(self) -> dict:
        return {"directing_state": [self.directing_dict]}


# Custom IO types for node connections
SceneIO = io.Custom("SCENE")
ActingIO = io.Custom("ACTING")


class SceneNode(io.ComfyNode):
    """
    Scene Node / Staging 3D Node
    Configures a 3D scene environment with multiple adjustable 3D assets (cubes).
    """

    OUTPUT_NODE = True

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="SceneNode",
            display_name="Staging 3D Node",
            category="SceneCameraAction",
            is_output_node=True,
            description="Configures a 3D scene environment with multiple assets.",
            inputs=[
                io.String.Input(
                    "scene",
                    multiline=True,
                    default="",
                    display_name="Scene Input",
                    tooltip="Connect text from Google Gemini / LLM (STRING) or scene JSON data directly",
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
        scene: Any = None,
    ) -> io.NodeOutput:
        print(f"[SceneNodeDebug] execute called with scene type: {type(scene)}, snippet: {str(scene)[:150]}", flush=True)
        scene_dict = {}

        if scene is not None:
            # 1. Try parsing as LLM blockout JSON (contains "boxes")
            transforms = parse_llm_blockout_json(scene)
            if transforms:
                scene_dict = {
                    "type": "cube_scene",
                    "num_assets": len(transforms),
                    "asset_transforms": transforms,
                }
            else:
                # 2. Try parsing as direct scene dict (contains "asset_transforms")
                if isinstance(scene, dict) and "asset_transforms" in scene:
                    scene_dict = scene
                elif isinstance(scene, str) and scene.strip():
                    try:
                        parsed = json.loads(scene)
                        if isinstance(parsed, dict) and "asset_transforms" in parsed:
                            scene_dict = parsed
                    except Exception as e:
                        print(f"[SceneNodeDebug] Error decoding scene json: {e}", flush=True)

        if not scene_dict:
            scene_dict = {
                "type": "cube_scene",
                "num_assets": 1,
                "asset_transforms": [],
            }

        print(f"[SceneNodeDebug] Final scene_dict num_assets: {scene_dict.get('num_assets')}, asset_transforms count: {len(scene_dict.get('asset_transforms', []))}", flush=True)
        scene_json = json.dumps(scene_dict)
        return io.NodeOutput(scene_json, ui=_SceneUIOutput(scene_dict))

    @classmethod
    def fingerprint_inputs(
        cls,
        scene: Any = None,
    ):
        import time
        return f"{scene}_{time.time()}"


class BlockoutSystemPromptNode(io.ComfyNode):
    """
    Blockout System Prompt Node
    Outputs the img2blockout system prompt instructions to connect to Google Gemini's prompt input.
    """

    OUTPUT_NODE = False

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="BlockoutSystemPromptNode",
            display_name="Blockout System Prompt",
            category="SceneCameraAction",
            is_output_node=False,
            description="Outputs the img2blockout system prompt instructions for Google Gemini.",
            inputs=[
                io.String.Input(
                    "user_prompt",
                    multiline=True,
                    default="",
                    display_name="User Prompt (Optional)",
                    tooltip="Optional extra instructions to append to the blockout prompt",
                ),
            ],
            outputs=[
                io.String.Output("system_prompt", display_name="System Prompt"),
            ],
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def execute(
        cls,
        user_prompt: str = "",
    ) -> io.NodeOutput:
        full_prompt = IMG2BLOCKOUT_SYSTEM_PROMPT
        if user_prompt and user_prompt.strip():
            full_prompt += f"\n\nUser Request: {user_prompt.strip()}"
        return io.NodeOutput(full_prompt)

    @classmethod
    def fingerprint_inputs(
        cls,
        user_prompt: str = "",
    ):
        return f"{user_prompt}"


class SceneFromLLMNode(io.ComfyNode):
    """
    Blockout 3D from LLM Node
    Parses text from Google Gemini Partner Node (or any LLM node) into 3D BoxGeometry blockout scene data.
    Requires NO API Keys as authentication is handled by the Gemini Partner Node / Comfy Cloud.
    """

    OUTPUT_NODE = True

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="SceneFromLLMNode",
            display_name="Blockout 3D from LLM",
            category="SceneCameraAction",
            is_output_node=True,
            description="Parses text output from Google Gemini Partner Node into 3D blockout scene data (No API Key required).",
            inputs=[
                io.String.Input(
                    "llm_response",
                    multiline=True,
                    default="",
                    display_name="LLM Response",
                    tooltip="Connect to the text output of the Google Gemini Partner Node",
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
        llm_response: Any = "",
    ) -> io.NodeOutput:
        transforms = parse_llm_blockout_json(llm_response)
        scene_dict = {
            "type": "cube_scene",
            "num_assets": len(transforms),
            "asset_transforms": transforms,
        }
        scene_json = json.dumps(scene_dict)
        return io.NodeOutput(scene_json, ui=_SceneUIOutput(scene_dict))

    @classmethod
    def fingerprint_inputs(
        cls,
        llm_response: str = "",
    ):
        import time
        return f"{llm_response}_{time.time()}"





class ActingNode(io.ComfyNode):
    """
    Acting Node
    Receives scene data from a SceneNode and hosts interactive character acting.
    """

    OUTPUT_NODE = True

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ActingNode",
            display_name="Acting 3D Node",
            category="SceneCameraAction",
            is_output_node=True,
            description="Receives a 3D scene from SceneNode and hosts interactive character acting.",
            inputs=[
                SceneIO.Input(
                    "scene",
                    display_name="Scene",
                    tooltip="Scene data connection from a SceneNode",
                    optional=True,
                ),
                io.Float.Input(
                    "character_speed",
                    default=10.0, min=1.0, max=20.0, step=1.0,
                    display_name="Character Speed",
                    tooltip="Movement speed of the 3D character",
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
                    tooltip="Serialized JSON recording of character acting (hidden)",
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
        character_speed: float = 10.0,
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
            "character_speed": character_speed,
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

    OUTPUT_NODE = True

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="DirectingNode",
            display_name="Directing 3D Node",
            category="SceneCameraAction",
            is_output_node=True,
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
                ),
            ],
            outputs=[
                io.Video.Output("captured_video", display_name="Captured Video"),
                io.Image.Output("captured_stage", display_name="Captured Stage"),
            ],
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def execute(
        cls,
        acting: str | dict | None = None,
        directing_data: str = "",
    ) -> io.NodeOutput:
        input_dir = folder_paths.get_input_directory()

        # 1. Load Video
        video_path = os.path.join(input_dir, "3d_directing_record.webm")
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

        # 2. Load Captured Stage Overview Image
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
        import time
        return f"{acting}_{directing_data}_{time.time()}"


class SceneCameraActionExtension(ComfyExtension):
    @override
    async def get_node_list(self):
        return [SceneNode, ActingNode, DirectingNode, SceneFromLLMNode, BlockoutSystemPromptNode]






# --- API Routes to receive video and image uploads ---
@PromptServer.instance.routes.post("/scene_camera_action/upload_video")
async def upload_video(request):
    post = await request.post()
    video_file = post.get("video")

    if video_file:
        input_dir = folder_paths.get_input_directory()
        filename = "3d_directing_record.webm"
        filepath = os.path.join(input_dir, filename)

        with open(filepath, "wb") as f:
            f.write(video_file.file.read())

        return web.json_response({"success": True, "filepath": filepath, "filename": filename})
    return web.json_response({"success": False, "error": "No video file received"})


@PromptServer.instance.routes.post("/scene_camera_action/upload_image")
async def upload_image(request):
    post = await request.post()
    image_file = post.get("image")

    if image_file:
        input_dir = folder_paths.get_input_directory()
        filename = "3d_directing_stage.png"
        filepath = os.path.join(input_dir, filename)

        with open(filepath, "wb") as f:
            f.write(image_file.file.read())

        return web.json_response({"success": True, "filepath": filepath, "filename": filename})
    return web.json_response({"success": False, "error": "No image file received"})


async def comfy_entrypoint():
    return SceneCameraActionExtension()
