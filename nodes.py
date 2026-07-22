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
    ) -> io.NodeOutput:
        scene_dict = {
            "type": "cube_scene",
            "num_assets": num_assets,
        }

        # Convert dict to JSON string for pipeline IO
        scene_json = json.dumps(scene_dict)
        return io.NodeOutput(scene_json, ui=_SceneUIOutput(scene_dict))

    @classmethod
    def fingerprint_inputs(
        cls,
        num_assets: int,
    ):
        return f"{num_assets}"


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
                    default=1.0, min=0.1, max=5.0, step=0.1,
                    display_name="Character Speed",
                    tooltip="Movement speed of the 3D character",
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
        character_speed: float = 1.0,
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
        }

        acting_json = json.dumps(acting_dict)
        return io.NodeOutput(acting_json, ui=_ActingUIOutput(acting_dict))


class SceneCameraActionExtension(ComfyExtension):
    async def get_node_list(self):
        return [SceneNode, ActingNode]


async def comfy_entrypoint():
    return SceneCameraActionExtension()
