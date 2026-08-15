"""
Helper utilities for stage-builder AI Skill (ComfyUI-scene-camera-action)

Core Mathematical & Validation Engine:
- Domain-agnostic 3D box primitive builders and coordinate arithmetic.
- 5 universal pure geometric generators (segments, linear arrays, radial arcs, stepped inclines, sloped ramps).
- Deterministic Quality Gates (schema validation, world boundaries, ground alignment, hierarchy inspection, mirroring).
- Command-line interface for stage JSON validation, repair, and inspection.
"""

from __future__ import annotations
import argparse
import json
import math
import random
import sys
from typing import Any, Dict, List, Optional, Tuple


# ==============================================================================
# 1. CORE PRIMITIVE BUILDERS & ARITHMETIC
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
# 2. 5 UNIVERSAL PURE GEOMETRIC GENERATORS
# ==============================================================================

def create_segment_between(
    name: str,
    p1: Tuple[float, float],
    p2: Tuple[float, float],
    width: float,
    height: float,
    y_center: float,
    node_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    1. VECTOR SEGMENT: Creates a linear block connecting 2D points p1=(x1, z1) to p2=(x2, z2).
    Automatically computes exact length, midpoint position, and Three.js Euler Ry heading angle
    using math.atan2(dx, dz), eliminating manual rotation errors.
    """
    x1, z1 = float(p1[0]), float(p1[1])
    x2, z2 = float(p2[0]), float(p2[1])
    dx = x2 - x1
    dz = z2 - z1
    length = math.sqrt(dx * dx + dz * dz)
    mx = (x1 + x2) / 2.0
    mz = (z1 + z2) / 2.0
    ry = math.atan2(dx, dz)
    return create_block_node(
        name=name,
        px=mx, py=y_center, pz=mz,
        sx=width, sy=height, sz=length,
        ry=ry,
        node_id=node_id
    )


def generate_linear_array(
    name_prefix: str,
    start_pos: Tuple[float, float, float],
    count: int,
    step_vector: Tuple[float, float, float],
    block_size: Tuple[float, float, float],
    rotation: Tuple[float, float, float] = (0.0, 0.0, 0.0)
) -> List[Dict[str, Any]]:
    """
    2. LINEAR ARRAY: Generates an array of N identical blocks distributed along a 3D step vector.
    Used for columns, pillars, fence posts, street curbs, barriers, sleepers, lights.
    """
    blocks = []
    sx_b, sy_b, sz_b = block_size
    rx_r, ry_r, rz_r = rotation
    x0, y0, z0 = start_pos
    dx, dy, dz = step_vector

    for i in range(max(1, count)):
        px = x0 + i * dx
        py = y0 + i * dy
        pz = z0 + i * dz
        blocks.append(
            create_block_node(
                name=f"{name_prefix} {i+1}",
                px=px, py=py, pz=pz,
                sx=sx_b, sy=sy_b, sz=sz_b,
                rx=rx_r, ry=ry_r, rz=rz_r
            )
        )
    return blocks


def generate_radial_arc(
    name_prefix: str,
    center_pos: Tuple[float, float, float] = (0.0, 0.0, 0.0),
    radius: float = 10.0,
    start_angle_deg: float = 0.0,
    end_angle_deg: float = 90.0,
    segments: int = 8,
    block_width: float = 2.0,
    block_height: float = 0.5,
    block_thickness: float = 0.5
) -> List[Dict[str, Any]]:
    """
    3. RADIAL ARC: Generates an array of rotated blocks forming a smooth circular curve or full circle.
    Used for curved roads, circular towers, colosseums, semicircular plazas, arches, arenas.
    """
    blocks = []
    start_rad = math.radians(start_angle_deg)
    end_rad = math.radians(end_angle_deg)
    total_angle = end_rad - start_rad
    step_angle = total_angle / max(1, segments)

    cx0, cy0, cz0 = center_pos
    arc_length = (abs(total_angle) * radius) / max(1, segments) + 0.05

    for i in range(segments):
        mid_angle = start_rad + (i + 0.5) * step_angle
        # Tangent position on circumference
        px = cx0 + radius * math.sin(mid_angle)
        pz = cz0 + radius * math.cos(mid_angle)
        py = cy0 + (block_height / 2.0)

        blocks.append(
            create_block_node(
                name=f"{name_prefix} Segment {i+1}",
                px=px, py=py, pz=pz,
                sx=block_width, sy=block_height, sz=arc_length,
                ry=mid_angle
            )
        )
    return blocks


def generate_stepped_incline(
    name_prefix: str,
    start_pos: Tuple[float, float, float] = (0.0, 0.0, 0.0),
    num_steps: int = 6,
    step_width: float = 2.0,
    step_height: float = 0.2,
    step_depth: float = 0.4,
    heading_rad: float = 0.0
) -> List[Dict[str, Any]]:
    """
    4. STEPPED INCLINE: Generates a staircase, tiered seating, terraced terrain, or stepped wall.
    Calculates accumulated Y elevation and forward displacement along heading_rad.
    """
    blocks = []
    start_x, start_y, start_z = start_pos

    for i in range(max(1, num_steps)):
        cy = start_y + (i * step_height) + (step_height / 2.0)
        forward_dist = i * step_depth + (step_depth / 2.0)
        cx = start_x + forward_dist * math.sin(heading_rad)
        cz = start_z + forward_dist * math.cos(heading_rad)

        blocks.append(
            create_block_node(
                name=f"{name_prefix} Step {i+1}",
                px=cx, py=cy, pz=cz,
                sx=step_width, sy=step_height, sz=step_depth,
                ry=heading_rad
            )
        )
    return blocks


def generate_sloped_ramp(
    name: str,
    start_pos: Tuple[float, float, float] = (0.0, 0.0, 0.0),
    length: float = 10.0,
    height: float = 2.5,
    width: float = 4.0,
    thickness: float = 0.2,
    heading_rad: float = 0.0
) -> Dict[str, Any]:
    """
    5. SLOPED RAMP: Generates a continuous angled planar ramp/wedge with automatic pitch (Rx) and heading (Ry).
    Used for roadway ramps, roofs, slides, conveyor inclines, vehicle jump pads.
    """
    pitch_angle = -math.atan2(height, length)  # rx tilt angle
    hypotenuse_length = math.sqrt(length**2 + height**2)

    start_x, start_y, start_z = start_pos
    mid_forward = length / 2.0
    cx = start_x + mid_forward * math.sin(heading_rad)
    cy = start_y + (height / 2.0)
    cz = start_z + mid_forward * math.cos(heading_rad)

    return create_block_node(
        name=name,
        px=cx, py=cy, pz=cz,
        sx=width, sy=thickness, sz=hypotenuse_length,
        rx=pitch_angle, ry=heading_rad, rz=0.0
    )


# Compatibility aliases
generate_staircase_blocks = generate_stepped_incline
generate_curved_track_blocks = generate_radial_arc
generate_ramp_blocks = generate_sloped_ramp


# ==============================================================================
# 3. DETERMINISTIC VALIDATION GATES & QUALITY ASSURANCE
# ==============================================================================

def validate_stage_state(stage_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Validates and cleans StageState structure.
    - Ensures stage type is 'cube_stage'.
    - Recursively cleans nodes, sanitizes transforms, and counts total 'block' primitives.
    - Strips legacy 'spawn_point' if present (spawn points belong to ActingState).
    """
    if not isinstance(stage_data, dict):
        stage_data = {}

    stage_data["type"] = "cube_stage"
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
    Checks if all block positions reside within [-max_boundary, max_boundary]
    and do not sink below ground level (Y < 0).
    """
    issues = []

    def check_node(node: Dict[str, Any], parent_tf: Optional[Dict[str, float]] = None):
        tf = node.get("transform", {})
        px = tf.get("px", 0.0)
        pz = tf.get("pz", 0.0)
        py = tf.get("py", 0.0)
        sy = tf.get("sy", 1.0)

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
    Automatically aligns root-level ground blocks to Py = Sy / 2.0.
    """
    fixed_count = 0
    for node in stage_data.get("nodes", []):
        if node.get("type") == "block":
            tf = node.get("transform", {})
            py = tf.get("py", 0.0)
            sy = tf.get("sy", 1.0)
            expected_py = round(sy / 2.0, 4)
            if abs(py - expected_py) > 0.001 and abs(py - expected_py) < 1.5:
                tf["py"] = expected_py
                fixed_count += 1
    return stage_data, fixed_count


def inspect_stage(stage_data: Dict[str, Any]) -> str:
    """
    Generates a structured ASCII inspection report of stage hierarchy, bounds, and stats.
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
    parser = argparse.ArgumentParser(description="Stage Builder Universal Utilities & Quality Gates")
    parser.add_argument("file", nargs="?", help="Path to StageState JSON file")
    parser.add_argument("--inspect", action="store_true", help="Print ASCII inspection report")
    parser.add_argument("--validate", action="store_true", help="Validate and clean JSON structure")
    parser.add_argument("--fix-ground", action="store_true", help="Auto-fix root ground alignment")
    parser.add_argument("--flip-x", action="store_true", help="Mirror stage along X axis (inverts left/right)")
    parser.add_argument("--flip-z", action="store_true", help="Mirror stage along Z axis (inverts front/back)")
    parser.add_argument("-o", "--output", help="Save output to file")

    args = parser.parse_args()

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
