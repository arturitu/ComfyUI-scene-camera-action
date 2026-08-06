"""
Helper utilities for scene-staging-builder Skill
Provides spatial math calculations, curve/spline block array generation,
and JSON validation for ComfyUI-scene-camera-action SceneState format.
"""

from __future__ import annotations
import json
import math
import random
from typing import Any, Dict, List, Optional, Tuple


def create_block_node(
    name: str,
    px: float, py: float, pz: float,
    sx: float, sy: float, sz: float,
    rx: float = 0.0, ry: float = 0.0, rz: float = 0.0,
    node_id: Optional[str] = None
) -> Dict[str, Any]:
    """Creates a standard block node with specified transform."""
    return {
        "id": node_id or f"block_{random.randint(10000, 99999)}",
        "type": "block",
        "name": name,
        "transform": {
            "px": float(px), "py": float(py), "pz": float(pz),
            "rx": float(rx), "ry": float(ry), "rz": float(rz),
            "sx": float(sx), "sy": float(sy), "sz": float(sz)
        }
    }


def create_group_node(
    name: str,
    children: List[Dict[str, Any]],
    px: float = 0.0, py: float = 0.0, pz: float = 0.0,
    rx: float = 0.0, ry: float = 0.0, rz: float = 0.0,
    sx: float = 1.0, sy: float = 1.0, sz: float = 1.0,
    node_id: Optional[str] = None
) -> Dict[str, Any]:
    """Creates a group node containing child blocks or sub-groups."""
    return {
        "id": node_id or f"group_{random.randint(1000, 9999)}",
        "type": "group",
        "name": name,
        "transform": {
            "px": float(px), "py": float(py), "pz": float(pz),
            "rx": float(rx), "ry": float(ry), "rz": float(rz),
            "sx": float(sx), "sy": float(sy), "sz": float(sz)
        },
        "children": children
    }


def generate_curved_track_blocks(
    start_pos: Tuple[float, float, float],
    radius: float = 8.0,
    angle_degrees: float = 90.0,
    segments: int = 8,
    road_width: float = 4.0,
    road_thickness: float = 0.2
) -> List[Dict[str, Any]]:
    """Generates an array of rotated blocks forming a smooth curved track."""
    blocks = []
    angle_rad = math.radians(angle_degrees)
    step_angle = angle_rad / max(1, segments)

    start_x, start_y, start_z = start_pos
    segment_length = (2 * math.pi * radius * (angle_degrees / 360.0)) / max(1, segments) + 0.1

    for i in range(segments):
        curr_angle = i * step_angle
        # Center of segment along arc
        mid_angle = curr_angle + step_angle / 2.0

        cx = start_x + radius * (1.0 - math.cos(mid_angle))
        cz = start_z + radius * math.sin(mid_angle)
        cy = start_y + road_thickness / 2.0

        blocks.append(
            create_block_node(
                name=f"Curved Segment {i+1}",
                px=cx, py=cy, pz=cz,
                sx=road_width, sy=road_thickness, sz=segment_length,
                ry=mid_angle
            )
        )

    return blocks


def calculate_top_surface_height(block_py: float, block_sy: float) -> float:
    """Calculates the top surface Y height of a supporting block (Y_top = py + sy / 2.0)."""
    return float(block_py) + (float(block_sy) / 2.0)


def create_spawn_point(
    px: float = 0.0,
    py: float = 0.0,
    pz: float = 2.0,
    ry: float = 0.0,
    supporting_block: Optional[Dict[str, Any]] = None
) -> Dict[str, float]:
    """
    Creates a spawn_point dict for actor placement.
    If supporting_block is provided, py is automatically calculated as the top surface of the block (Y_top = py + sy / 2.0).
    """
    spawn_py = float(py)
    if supporting_block and "transform" in supporting_block:
        transform = supporting_block["transform"]
        b_py = transform.get("py", 0.0)
        b_sy = transform.get("sy", 0.0)
        spawn_py = calculate_top_surface_height(b_py, b_sy)

    return {
        "px": float(px),
        "py": float(spawn_py),
        "pz": float(pz),
        "ry": float(ry)
    }


def validate_scene_state(scene_data: Dict[str, Any]) -> Dict[str, Any]:
    """Validates SceneState structure and updates total block count."""
    if not isinstance(scene_data, dict):
        scene_data = {}

    scene_data["type"] = "cube_scene"
    nodes = scene_data.get("nodes", [])
    if not isinstance(nodes, list):
        nodes = []

    if "spawn_point" in scene_data and isinstance(scene_data["spawn_point"], dict):
        sp = scene_data["spawn_point"]
        scene_data["spawn_point"] = {
            "px": float(sp.get("px", 0.0)),
            "py": float(sp.get("py", 0.0)),
            "pz": float(sp.get("pz", 2.0)),
            "ry": float(sp.get("ry", 0.0))
        }

    block_count = 0

    def count_and_clean(node: Dict[str, Any]) -> Dict[str, Any]:
        nonlocal block_count
        n_type = str(node.get("type", "block")).lower()

        if n_type == "block":
            block_count += 1
        elif n_type == "group":
            children = node.get("children", [])
            if isinstance(children, list):
                node["children"] = [count_and_clean(c) for c in children if isinstance(c, dict)]

        return node

    clean_nodes = [count_and_clean(n) for n in nodes if isinstance(n, dict)]
    scene_data["nodes"] = clean_nodes
    scene_data["num_assets"] = block_count
    return scene_data
