"""
ComfyUI Scene Camera Action Nodes
Custom nodes for 3D scene setup and character acting within ComfyUI.
"""

from __future__ import annotations
import json
from comfy_api.latest import ComfyExtension, io
from comfy_api.latest._io import _UIOutput


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


# Custom IO types for node connections
SceneIO = io.Custom("SCENE")
ActingIO = io.Custom("ACTING")


class SceneNode(io.ComfyNode):
    """
    Scene Node
    Configures a 3D scene environment with multiple adjustable 3D assets (cubes).
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="SceneNode",
            display_name="Scene 3D Node",
            category="SceneCameraAction",
            is_output_node=False,
            description="Configures a 3D scene environment with multiple assets.",
            inputs=[
                io.Int.Input(
                    "num_assets",
                    default=1, min=1, max=12, step=1,
                    display_name="Number of Assets",
                    tooltip="Number of 3D assets to render in the scene",
                ),
                io.String.Input(
                    "scene_data",
                    default="",
                    display_name="Scene Data",
                    tooltip="Serialized JSON data of the scene configurations (hidden)",
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
        num_assets: int,
        scene_data: str = "",
    ) -> io.NodeOutput:
        # Prioritize the serialized scene_data from frontend if it exists
        scene_dict = {}
        if scene_data.strip():
            try:
                scene_dict = json.loads(scene_data)
            except Exception:
                pass

        if not scene_dict:
            scene_dict = {
                "type": "cube_scene",
                "num_assets": num_assets,
                "asset_transforms": [],
            }

        # Convert dict to JSON string for pipeline IO
        scene_json = json.dumps(scene_dict)
        return io.NodeOutput(scene_json, ui=_SceneUIOutput(scene_dict))

    @classmethod
    def fingerprint_inputs(
        cls,
        num_assets: int,
        scene_data: str = "",
    ):
        return f"{num_assets}_{scene_data}"


class ActingNode(io.ComfyNode):
    """
    Acting Node
    Receives scene data from a SceneNode and allows character control/interaction.
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ActingNode",
            display_name="Acting 3D Node",
            category="SceneCameraAction",
            is_output_node=False,
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


class _DirectingUIOutput(_UIOutput):
    """Sends directing state to the UI frontend."""

    def __init__(self, directing_dict: dict):
        super().__init__()
        self.directing_dict = directing_dict

    def as_dict(self) -> dict:
        return {"directing_state": self.directing_dict}


CameraIO = io.Custom("CAMERA")


class DirectingNode(io.ComfyNode):
    """
    Directing Node
    Records camera cut timelines on top of acting motion data.
    Scene is inherited from the connected Acting Data.
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="DirectingNode",
            display_name="Directing 3D Node",
            category="SceneCameraAction",
            is_output_node=False,
            description="Records camera cuts on top of acting data. Scene is inherited from ActingNode.",
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
                CameraIO.Output("camera_data", display_name="Camera Data"),
            ],
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def execute(
        cls,
        acting: str | dict | None = None,
        directing_data: str = "",
    ) -> io.NodeOutput:
        acting_data = {}
        if isinstance(acting, str) and acting.strip():
            try:
                acting_data = json.loads(acting)
            except Exception:
                acting_data = {"raw": acting}
        elif isinstance(acting, dict):
            acting_data = acting

        # Scene is embedded inside the acting_data
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

        directing_json = json.dumps(directing_dict)
        return io.NodeOutput(directing_json, ui=_DirectingUIOutput(directing_dict))


class SceneCameraActionExtension(ComfyExtension):
    async def get_node_list(self):
        return [SceneNode, ActingNode, DirectingNode]


async def comfy_entrypoint():
    return SceneCameraActionExtension()
