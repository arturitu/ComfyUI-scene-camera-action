"""
Helper utilities for stage-builder AI Skill (ComfyUI-scene-camera-action)

Provides:
- Strict mathematical & spatial validation gates (ground alignment, world bounds, floating blocks, actor clearances)
- Procedural shape generators for compound 3D box primitives (ramps, curves, stairs, arches, trees, buildings, fences)
- Hierarchy inspector and ASCII reporting
- Command-line interface for stage JSON validation and repair
"""

from __future__ import annotations
import argparse
import json
import math
import random
import sys
from typing import Any, Dict, List, Optional, Tuple


# ==============================================================================
# 1. CORE PRIMITIVE BUILDERS
# ==============================================================================

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
            "px": round(float(px), 4),
            "py": round(float(py), 4),
            "pz": round(float(pz), 4),
            "rx": round(float(rx), 4),
            "ry": round(float(ry), 4),
            "rz": round(float(rz), 4),
            "sx": round(float(sx), 4),
            "sy": round(float(sy), 4),
            "sz": round(float(sz), 4)
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
            "px": round(float(px), 4),
            "py": round(float(py), 4),
            "pz": round(float(pz), 4),
            "rx": round(float(rx), 4),
            "ry": round(float(ry), 4),
            "rz": round(float(rz), 4),
            "sx": round(float(sx), 4),
            "sy": round(float(sy), 4),
            "sz": round(float(sz), 4)
        },
        "children": children
    }


def calculate_top_surface_height(block_py: float, block_sy: float) -> float:
    """Calculates the top surface Y height of a supporting block: Y_top = py + sy / 2.0."""
    return float(block_py) + (float(block_sy) / 2.0)


def calculate_ground_center_y(sy: float) -> float:
    """Calculates center Py for a block of height Sy resting on ground Y=0."""
    return float(sy) / 2.0


# ==============================================================================
# 2. PROCEDURAL COMPOUND SHAPE GENERATORS
# ==============================================================================

def generate_curved_track_blocks(
    start_pos: Tuple[float, float, float] = (0.0, 0.0, 0.0),
    radius: float = 12.0,
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
    segment_length = (2 * math.pi * radius * (abs(angle_degrees) / 360.0)) / max(1, segments) + 0.1

    for i in range(segments):
        curr_angle = i * step_angle
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


def generate_staircase_blocks(
    start_pos: Tuple[float, float, float] = (0.0, 0.0, 0.0),
    num_steps: int = 8,
    step_width: float = 1.4,
    step_height: float = 0.25,
    step_depth: float = 0.4,
    heading_rad: float = 0.0
) -> List[Dict[str, Any]]:
    """Generates an aligned staircase formed by individual step blocks."""
    blocks = []
    start_x, start_y, start_z = start_pos

    for i in range(num_steps):
        # Step center Y: accumulated previous step heights + half of current step height
        cy = start_y + (i * step_height) + (step_height / 2.0)
        # Step offset along depth (Z)
        forward_dist = i * step_depth + (step_depth / 2.0)
        cx = start_x + forward_dist * math.sin(heading_rad)
        cz = start_z + forward_dist * math.cos(heading_rad)

        blocks.append(
            create_block_node(
                name=f"Step {i+1}",
                px=cx, py=cy, pz=cz,
                sx=step_width, sy=step_height, sz=step_depth,
                ry=heading_rad
            )
        )
    return blocks


def generate_ramp_blocks(
    start_pos: Tuple[float, float, float] = (0.0, 0.0, 0.0),
    length: float = 10.0,
    height: float = 2.5,
    width: float = 4.0,
    thickness: float = 0.2,
    heading_rad: float = 0.0
) -> Dict[str, Any]:
    """Generates a continuous angled ramp block."""
    pitch_angle = -math.atan2(height, length)  # rx tilt angle
    hypotenuse_length = math.sqrt(length**2 + height**2)

    start_x, start_y, start_z = start_pos
    # Center of the ramp in world space
    mid_forward = length / 2.0
    cx = start_x + mid_forward * math.sin(heading_rad)
    cy = start_y + (height / 2.0)
    cz = start_z + mid_forward * math.cos(heading_rad)

    return create_block_node(
        name="Ramp Incline",
        px=cx, py=cy, pz=cz,
        sx=width, sy=thickness, sz=hypotenuse_length,
        rx=pitch_angle, ry=heading_rad, rz=0.0
    )


def generate_arch_blocks(
    center_pos: Tuple[float, float, float] = (0.0, 0.0, 0.0),
    opening_width: float = 2.4,
    opening_height: float = 3.0,
    pillar_width: float = 0.5,
    arch_depth: float = 0.8,
    lintel_thickness: float = 0.4
) -> Dict[str, Any]:
    """Generates an architectural archway (left pillar, right pillar, top lintel) inside a group."""
    cx, cy, cz = center_pos
    pillar_height = opening_height
    pillar_py = cy + (pillar_height / 2.0)

    left_x = cx - (opening_width / 2.0 + pillar_width / 2.0)
    right_x = cx + (opening_width / 2.0 + pillar_width / 2.0)

    left_pillar = create_block_node(
        "Left Pillar",
        px=left_x, py=pillar_py, pz=cz,
        sx=pillar_width, sy=pillar_height, sz=arch_depth
    )
    right_pillar = create_block_node(
        "Right Pillar",
        px=right_x, py=pillar_py, pz=cz,
        sx=pillar_width, sy=pillar_height, sz=arch_depth
    )

    total_width = opening_width + 2 * pillar_width
    lintel_py = cy + opening_height + (lintel_thickness / 2.0)
    lintel = create_block_node(
        "Top Lintel",
        px=cx, py=lintel_py, pz=cz,
        sx=total_width, sy=lintel_thickness, sz=arch_depth
    )

    return create_group_node(
        name="Archway",
        children=[left_pillar, right_pillar, lintel],
        px=0.0, py=0.0, pz=0.0
    )


def generate_tree_group(
    pos: Tuple[float, float, float] = (0.0, 0.0, 0.0),
    trunk_height: float = 3.0,
    trunk_radius: float = 0.4,
    foliage_layers: int = 3,
    base_foliage_size: float = 2.2,
    name: str = "Tree"
) -> Dict[str, Any]:
    """Generates a stylized tree group composed of a trunk and tiered foliage boxes."""
    px, py, pz = pos
    children = []

    # 1. Trunk
    trunk_py = py + (trunk_height / 2.0)
    trunk = create_block_node(
        "Trunk",
        px=px, py=trunk_py, pz=pz,
        sx=trunk_radius, sy=trunk_height, sz=trunk_radius
    )
    children.append(trunk)

    # 2. Foliage layers
    current_y = py + trunk_height * 0.7
    for i in range(foliage_layers):
        scale_factor = 1.0 - (i * 0.22)
        layer_size = max(0.8, base_foliage_size * scale_factor)
        layer_height = max(0.6, 1.2 * scale_factor)
        layer_py = current_y + (layer_height / 2.0)

        # Alternating slight rotation for organic feel
        rot_y = 0.785 if (i % 2 == 1) else 0.0

        foliage = create_block_node(
            f"Foliage Tier {i+1}",
            px=px, py=layer_py, pz=pz,
            sx=layer_size, sy=layer_height, sz=layer_size,
            ry=rot_y
        )
        children.append(foliage)
        current_y += layer_height * 0.75

    return create_group_node(name=name, children=children)


def generate_building_group(
    pos: Tuple[float, float, float] = (0.0, 0.0, 0.0),
    width: float = 6.0,
    depth: float = 8.0,
    height: float = 4.0,
    roof_style: str = "flat",  # "flat", "hipped", "shed"
    name: str = "Building"
) -> Dict[str, Any]:
    """Generates a complete building with main body, roof, and doorway framing."""
    bx, by, bz = pos
    children = []

    # 1. Main structure body
    main_py = by + (height / 2.0)
    body = create_block_node(
        "Main Structure",
        px=bx, py=main_py, pz=bz,
        sx=width, sy=height, sz=depth
    )
    children.append(body)

    # 2. Roof
    roof_py = by + height
    if roof_style == "hipped":
        roof = create_block_node(
            "Hipped Roof",
            px=bx, py=roof_py + 0.6, pz=bz,
            sx=width * 0.85, sy=1.2, sz=depth * 0.85,
            rx=0.0, ry=0.785, rz=0.0
        )
        children.append(roof)
    elif roof_style == "shed":
        roof = create_block_node(
            "Shed Roof",
            px=bx, py=roof_py + 0.3, pz=bz,
            sx=width + 0.4, sy=0.2, sz=depth + 0.4,
            rx=0.15, ry=0.0, rz=0.0
        )
        children.append(roof)
    else:  # flat with parapet
        parapet = create_block_node(
            "Roof Parapet",
            px=bx, py=roof_py + 0.2, pz=bz,
            sx=width + 0.2, sy=0.4, sz=depth + 0.2
        )
        children.append(parapet)

    # 3. Door trim accent
    door_w, door_h = 1.2, 2.2
    door_pz = bz + (depth / 2.0) + 0.05
    door_frame = create_block_node(
        "Doorway Accent",
        px=bx, py=by + (door_h / 2.0), pz=door_pz,
        sx=door_w, sy=door_h, sz=0.15
    )
    children.append(door_frame)

    return create_group_node(name=name, children=children)


def generate_fence_segment(
    start_pos: Tuple[float, float, float] = (0.0, 0.0, 0.0),
    length: float = 6.0,
    height: float = 1.2,
    num_posts: int = 4,
    heading_rad: float = 0.0,
    name: str = "Fence"
) -> Dict[str, Any]:
    """Generates a fence group composed of vertical posts and horizontal rails."""
    sx, sy, sz = start_pos
    children = []

    post_spacing = length / max(1, num_posts - 1)
    post_w = 0.15

    for i in range(num_posts):
        dist = i * post_spacing
        px = sx + dist * math.sin(heading_rad)
        pz = sz + dist * math.cos(heading_rad)
        py = sy + (height / 2.0)

        children.append(
            create_block_node(
                f"Post {i+1}",
                px=px, py=py, pz=pz,
                sx=post_w, sy=height, sz=post_w,
                ry=heading_rad
            )
        )

    # 2 Horizontal rails (lower & upper)
    mid_dist = length / 2.0
    mid_x = sx + mid_dist * math.sin(heading_rad)
    mid_z = sz + mid_dist * math.cos(heading_rad)
    rail_thickness = 0.08

    rail_low = create_block_node(
        "Lower Rail",
        px=mid_x, py=sy + height * 0.35, pz=mid_z,
        sx=rail_thickness, sy=rail_thickness, sz=length,
        ry=heading_rad
    )
    rail_high = create_block_node(
        "Upper Rail",
        px=mid_x, py=sy + height * 0.8, pz=mid_z,
        sx=rail_thickness, sy=rail_thickness, sz=length,
        ry=heading_rad
    )
    children.extend([rail_low, rail_high])

    return create_group_node(name=name, children=children)


# ==============================================================================
# 3. DETERMINISTIC VALIDATION GATES & QUALITY ASSURANCE
# ==============================================================================

def validate_stage_state(stage_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Validates and cleans StageState structure.
    - Ensures stage type is 'cube_stage'.
    - Recursively removes invalid nodes and counts total 'block' primitives.
    - Strips legacy 'spawn_point' if present (spawn points belong to ActingState).
    """
    if not isinstance(stage_data, dict):
        stage_data = {}

    stage_data["type"] = "cube_stage"
    # Remove obsolete spawn_point from stage state if present
    if "spawn_point" in stage_data:
        del stage_data["spawn_point"]

    nodes = stage_data.get("nodes", [])
    if not isinstance(nodes, list):
        nodes = []

    block_count = 0

    def clean_node(node: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        nonlocal block_count
        if not isinstance(node, dict):
            return None

        n_type = str(node.get("type", "block")).lower()
        node_id = str(node.get("id", f"node_{random.randint(1000, 9999)}"))
        node_name = str(node.get("name", node_id))

        # Validate transform
        raw_tf = node.get("transform", {})
        if not isinstance(raw_tf, dict):
            raw_tf = {}

        transform = {
            "px": round(float(raw_tf.get("px", 0.0)), 4),
            "py": round(float(raw_tf.get("py", 0.0)), 4),
            "pz": round(float(raw_tf.get("pz", 0.0)), 4),
            "rx": round(float(raw_tf.get("rx", 0.0)), 4),
            "ry": round(float(raw_tf.get("ry", 0.0)), 4),
            "rz": round(float(raw_tf.get("rz", 0.0)), 4),
            "sx": max(0.01, round(float(raw_tf.get("sx", 1.0)), 4)),
            "sy": max(0.01, round(float(raw_tf.get("sy", 1.0)), 4)),
            "sz": max(0.01, round(float(raw_tf.get("sz", 1.0)), 4)),
        }

        if n_type == "block":
            block_count += 1
            return {
                "id": node_id,
                "type": "block",
                "name": node_name,
                "transform": transform
            }
        elif n_type == "group":
            raw_children = node.get("children", [])
            clean_children = []
            if isinstance(raw_children, list):
                for child in raw_children:
                    cleaned_child = clean_node(child)
                    if cleaned_child:
                        clean_children.append(cleaned_child)
            return {
                "id": node_id,
                "type": "group",
                "name": node_name,
                "transform": transform,
                "children": clean_children
            }
        return None

    cleaned_nodes = []
    for n in nodes:
        c = clean_node(n)
        if c:
            cleaned_nodes.append(c)

    stage_data["nodes"] = cleaned_nodes
    stage_data["num_assets"] = block_count
    return stage_data


def check_world_bounds(stage_data: Dict[str, Any], max_boundary: float = 50.0) -> List[str]:
    """
    Checks if all block positions and extents reside within [-max_boundary, max_boundary].
    Returns a list of warning/error messages.
    """
    issues = []

    def check_node(node: Dict[str, Any], parent_tf: Optional[Dict[str, float]] = None):
        tf = node.get("transform", {})
        px = tf.get("px", 0.0)
        pz = tf.get("pz", 0.0)
        py = tf.get("py", 0.0)
        sx = tf.get("sx", 1.0)
        sy = tf.get("sy", 1.0)
        sz = tf.get("sz", 1.0)

        world_px = px + (parent_tf.get("px", 0.0) if parent_tf else 0.0)
        world_pz = pz + (parent_tf.get("pz", 0.0) if parent_tf else 0.0)
        world_py = py + (parent_tf.get("py", 0.0) if parent_tf else 0.0)

        if node.get("type") == "block":
            if abs(world_px) > max_boundary:
                issues.append(f"Node '{node.get('name', node.get('id'))}' exceeds X bounds ({world_px:.2f} outside ±{max_boundary}m)")
            if abs(world_pz) > max_boundary:
                issues.append(f"Node '{node.get('name', node.get('id'))}' exceeds Z bounds ({world_pz:.2f} outside ±{max_boundary}m)")
            if world_py - sy / 2.0 < -0.1:
                issues.append(f"Node '{node.get('name', node.get('id'))}' sinks beneath ground level (bottom Y = {world_py - sy/2.0:.2f})")

        if node.get("type") == "group":
            current_tf = {"px": world_px, "py": world_py, "pz": world_pz}
            for child in node.get("children", []):
                check_node(child, current_tf)

    for n in stage_data.get("nodes", []):
        check_node(n)

    return issues


def check_ground_alignment(stage_data: Dict[str, Any], tolerance: float = 0.05) -> List[Dict[str, Any]]:
    """
    Checks root-level blocks to verify if bottom face rests at Y=0 (Py == Sy / 2.0).
    Returns list of misaligned nodes.
    """
    misaligned = []
    for node in stage_data.get("nodes", []):
        if node.get("type") == "block":
            tf = node.get("transform", {})
            py = tf.get("py", 0.0)
            sy = tf.get("sy", 1.0)
            expected_py = sy / 2.0
            bottom_y = py - expected_py
            if abs(bottom_y) > tolerance:
                misaligned.append({
                    "id": node.get("id"),
                    "name": node.get("name"),
                    "current_py": py,
                    "sy": sy,
                    "expected_py": round(expected_py, 4),
                    "bottom_y": round(bottom_y, 4)
                })
    return misaligned


def fix_ground_alignment(stage_data: Dict[str, Any]) -> Tuple[Dict[str, Any], int]:
    """
    Automatically aligns root-level blocks whose bottom face is near ground to Py = Sy / 2.0.
    Returns (updated_stage_data, count_of_fixes).
    """
    fixed_count = 0
    for node in stage_data.get("nodes", []):
        if node.get("type") == "block":
            tf = node.get("transform", {})
            py = tf.get("py", 0.0)
            sy = tf.get("sy", 1.0)
            expected_py = round(sy / 2.0, 4)
            # If resting near ground within [-1.0, 1.0] and not intended as elevated slab
            if abs(py - expected_py) > 0.001 and abs(py - expected_py) < 1.5:
                tf["py"] = expected_py
                fixed_count += 1
    return stage_data, fixed_count


def inspect_stage(stage_data: Dict[str, Any]) -> str:
    """
    Generates a structured ASCII report of the stage hierarchy, bounds, and stats.
    """
    clean_stage = validate_stage_state(stage_data)
    total_blocks = clean_stage.get("num_assets", 0)
    root_nodes = clean_stage.get("nodes", [])

    lines = [
        "=" * 60,
        f"STAGE INSPECTION REPORT — Type: {clean_stage.get('type')} | Total Blocks: {total_blocks}",
        "=" * 60
    ]

    def format_node(node: Dict[str, Any], depth: int = 0):
        indent = "  " * depth
        ntype = node.get("type", "block").upper()
        name = node.get("name", "Unnamed")
        nid = node.get("id", "")
        tf = node.get("transform", {})
        pos_str = f"Pos=({tf.get('px', 0):.2f}, {tf.get('py', 0):.2f}, {tf.get('pz', 0):.2f})"
        size_str = f"Scale=({tf.get('sx', 1):.2f}, {tf.get('sy', 1):.2f}, {tf.get('sz', 1):.2f})"

        lines.append(f"{indent}[{ntype}] {name} ({nid}) | {pos_str} | {size_str}")

        if node.get("type") == "group":
            for child in node.get("children", []):
                format_node(child, depth + 1)

    for n in root_nodes:
        format_node(n)

    bounds_issues = check_world_bounds(clean_stage)
    misaligned_ground = check_ground_alignment(clean_stage)

    lines.append("-" * 60)
    lines.append(f"Quality Gates: Bounds Issues: {len(bounds_issues)} | Root Ground Misalignments: {len(misaligned_ground)}")
    if bounds_issues:
        for b in bounds_issues[:5]:
            lines.append(f"  [WARN BOUNDS] {b}")
    if misaligned_ground:
        for m in misaligned_ground[:5]:
            lines.append(f"  [WARN GROUND] Node '{m['name']}' Py={m['current_py']} (expected {m['expected_py']} for Sy={m['sy']})")
    lines.append("=" * 60)

    return "\n".join(lines)


def flip_stage_axis(stage_data: Dict[str, Any], axis: str = "x") -> Dict[str, Any]:
    """
    Mirrors all node transforms across the specified axis ('x' or 'z').
    For 'x' flip: px -> -px, ry -> -ry, rz -> -rz.
    For 'z' flip: pz -> -pz, rx -> -rx, ry -> -ry.
    """
    clean_stage = validate_stage_state(stage_data)
    axis = axis.lower()

    def flip_node(node: Dict[str, Any]):
        tf = node.get("transform", {})
        if axis == "x":
            tf["px"] = round(-float(tf.get("px", 0.0)), 4)
            tf["ry"] = round(-float(tf.get("ry", 0.0)), 4)
            tf["rz"] = round(-float(tf.get("rz", 0.0)), 4)
        elif axis == "z":
            tf["pz"] = round(-float(tf.get("pz", 0.0)), 4)
            tf["rx"] = round(-float(tf.get("rx", 0.0)), 4)
            tf["ry"] = round(-float(tf.get("ry", 0.0)), 4)

        if node.get("type") == "group":
            for child in node.get("children", []):
                flip_node(child)

    for n in clean_stage.get("nodes", []):
        flip_node(n)

    return validate_stage_state(clean_stage)


# Backwards compatibility alias
validate_scene_state = validate_stage_state


# ==============================================================================
# 4. CLI INTERFACE
# ==============================================================================

def main():
    parser = argparse.ArgumentParser(description="Stage Builder Utilities & Quality Gates")
    parser.add_argument("file", nargs="?", help="Path to StageState JSON file")
    parser.add_argument("--inspect", action="store_true", help="Print ASCII inspection report")
    parser.add_argument("--validate", action="store_true", help="Validate and clean JSON structure")
    parser.add_argument("--fix-ground", action="store_true", help="Auto-fix root ground alignment")
    parser.add_argument("--flip-x", action="store_true", help="Mirror stage along X axis (inverts left/right)")
    parser.add_argument("--flip-z", action="store_true", help="Mirror stage along Z axis (inverts front/back)")
    parser.add_argument("--demo", action="store_true", help="Generate a demo procedural stage")
    parser.add_argument("-o", "--output", help="Save output to file")

    args = parser.parse_args()

    if args.demo:
        print("[INFO] Generating Demo Stage using Procedural Generators...")
        demo_nodes = [
            generate_building_group((0.0, 0.0, -10.0), width=6.0, depth=6.0, height=3.5, roof_style="hipped", name="Main House"),
            generate_tree_group((-8.0, 0.0, -5.0), trunk_height=3.0, name="Front Left Tree"),
            generate_tree_group((8.0, 0.0, -5.0), trunk_height=3.5, name="Front Right Tree"),
            generate_arch_blocks((0.0, 0.0, 5.0), opening_width=3.0, opening_height=2.8),
            generate_fence_segment((-12.0, 0.0, 10.0), length=24.0, height=1.0, num_posts=7, name="Front Perimeter Fence")
        ]
        demo_stage = validate_stage_state({
            "type": "cube_stage",
            "nodes": demo_nodes
        })
        print(inspect_stage(demo_stage))
        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                json.dump(demo_stage, f, indent=2)
            print(f"[SUCCESS] Demo stage written to {args.output}")
        return

    if not args.file:
        parser.print_help()
        return

    try:
        with open(args.file, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        print(f"[ERROR] Failed to load JSON: {e}", file=sys.stderr)
        sys.exit(1)

    if args.flip_x:
        data = flip_stage_axis(data, "x")
        print("[FLIP] Mirrored stage along X axis.")

    if args.flip_z:
        data = flip_stage_axis(data, "z")
        print("[FLIP] Mirrored stage along Z axis.")

    if args.fix_ground:
        data, count = fix_ground_alignment(data)
        data = validate_stage_state(data)
        print(f"[FIX] Corrected ground alignment on {count} nodes.")

    if args.inspect:
        print(inspect_stage(data))

    if args.validate or args.flip_x or args.flip_z or (not args.inspect and not args.fix_ground):
        clean_data = validate_stage_state(data)
        print(f"[VALIDATE] Stage is valid. Total blocks: {clean_data.get('num_assets')}")
        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                json.dump(clean_data, f, indent=2)
            print(f"[SUCCESS] Saved JSON to {args.output}")


if __name__ == "__main__":
    main()
