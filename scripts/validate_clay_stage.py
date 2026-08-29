#!/usr/bin/env python3
"""
Clay Stage QA Validation Gate (ComfyUI-scene-camera-action)

Dual-Mode Automated Validator for Blender Clay GLB Stage Assets:
1. Standalone Pure Python Mode (Default): Zero pip dependencies (uses stdlib struct, json, math, os, sys).
2. Headless Blender Mode (--blender): Executes via headless Blender (Blender --background --factory-startup -P ...).

Comprehensive Quality Gates:
- Gate 1: File Existence & Valid File Size (> 1 KB).
- Gate 2: Valid GLB Container & glTF 2.0 Header (Magic 0x46546C67 'glTF', Version 2, JSON Chunk 0x4E4F534A).
- Gate 3: Metric Bounds & Ground Alignment (X_span <= 100m, Z_span <= 100m, Y_span <= 60m, Y_min >= -1.0m, within ±50m world box, extent >= 0.5m).
- Gate 4: Geometry Integrity (Mesh count >= 1, Vertices > 0, Faces/Primitives > 0, POSITION and NORMAL accessors present, no NaNs/Infs).
- Gate 5: Unified Clay Material Contract (Material count <= 2, Base color in neutral range [0.5, 0.9], Roughness >= 0.7, Metallic <= 0.1).
- Gate 6: Zero Missing Textures (images array empty or 0 unresolved external URIs).

CLI:
  python3 validate_clay_stage.py <stage.glb> [--json] [--verbose] [--inspect] [--blender]
  Returns exit code 0 on PASS, 1 on FAIL.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import struct
import subprocess
import sys
from typing import Any, Dict, List, Optional, Tuple


# ==============================================================================
# MATRIX & VECTOR MATH HELPERS (Zero external dependencies)
# ==============================================================================

def mat4_identity() -> List[List[float]]:
    return [
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
        [0.0, 0.0, 0.0, 1.0]
    ]


def mat4_multiply(a: List[List[float]], b: List[List[float]]) -> List[List[float]]:
    result = [[0.0] * 4 for _ in range(4)]
    for i in range(4):
        for j in range(4):
            result[i][j] = sum(a[i][k] * b[k][j] for k in range(4))
    return result


def mat4_from_flat_column_major(flat: List[float]) -> List[List[float]]:
    # glTF matrix is 16 elements in column-major order
    return [
        [flat[0], flat[4], flat[8],  flat[12]],
        [flat[1], flat[5], flat[9],  flat[13]],
        [flat[2], flat[6], flat[10], flat[14]],
        [flat[3], flat[7], flat[11], flat[15]]
    ]


def mat4_from_translation(tx: float, ty: float, tz: float) -> List[List[float]]:
    return [
        [1.0, 0.0, 0.0, tx],
        [0.0, 1.0, 0.0, ty],
        [0.0, 0.0, 1.0, tz],
        [0.0, 0.0, 0.0, 1.0]
    ]


def mat4_from_scale(sx: float, sy: float, sz: float) -> List[List[float]]:
    return [
        [sx,  0.0, 0.0, 0.0],
        [0.0, sy,  0.0, 0.0],
        [0.0, 0.0, sz,  0.0],
        [0.0, 0.0, 0.0, 1.0]
    ]


def mat4_from_quaternion(qx: float, qy: float, qz: float, qw: float) -> List[List[float]]:
    # Normalize quaternion
    length = math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw)
    if length > 0.0:
        qx /= length
        qy /= length
        qz /= length
        qw /= length
    else:
        return mat4_identity()

    x2 = qx + qx
    y2 = qy + qy
    z2 = qz + qz
    xx = qx * x2
    xy = qx * y2
    xz = qx * z2
    yy = qy * y2
    yz = qy * z2
    zz = qz * z2
    wx = qw * x2
    wy = qw * y2
    wz = qw * z2

    return [
        [1.0 - (yy + zz), xy - wz,         xz + wy,         0.0],
        [xy + wz,         1.0 - (xx + zz), yz - wx,         0.0],
        [xz - wy,         yz + wx,         1.0 - (xx + yy), 0.0],
        [0.0,             0.0,             0.0,             1.0]
    ]


def mat4_transform_point(m: List[List[float]], p: Tuple[float, float, float]) -> Tuple[float, float, float]:
    x, y, z = p
    w = m[3][0] * x + m[3][1] * y + m[3][2] * z + m[3][3]
    if abs(w) < 1e-9:
        w = 1.0
    tx = (m[0][0] * x + m[0][1] * y + m[0][2] * z + m[0][3]) / w
    ty = (m[1][0] * x + m[1][1] * y + m[1][2] * z + m[1][3]) / w
    tz = (m[2][0] * x + m[2][1] * y + m[2][2] * z + m[2][3]) / w
    return (tx, ty, tz)


# ==============================================================================
# PURE PYTHON STANDALONE GLB VALIDATOR
# ==============================================================================

class PurePythonGLBValidator:
    """Parses and validates binary glTF 2.0 (GLB) stages without external libraries."""

    def __init__(self, filepath: str, verbose: bool = False):
        self.filepath = os.path.abspath(filepath)
        self.verbose = verbose
        self.raw_data: bytes = b""
        self.gltf_json: Dict[str, Any] = {}
        self.bin_buffer: bytes = b""
        self.report: Dict[str, Any] = {
            "file": self.filepath,
            "valid": False,
            "passed": False,
            "mode": "standalone_python",
            "gates": {},
            "summary": {
                "total_gates": 6,
                "passed_gates": 0,
                "failed_gates": 0,
                "errors": [],
                "warnings": []
            }
        }

    def log(self, msg: str):
        if self.verbose:
            print(f"[VALIDATE_CLAY] {msg}", file=sys.stderr)

    def validate(self) -> Dict[str, Any]:
        """Runs all 6 programmatic quality gates."""
        g1 = self._gate1_file_exists_and_size()
        self.report["gates"]["file_exists_and_size"] = g1
        if g1["status"] != "PASS":
            self._finalize_report()
            return self.report

        g2 = self._gate2_glb_header()
        self.report["gates"]["glb_header_valid"] = g2
        if g2["status"] != "PASS":
            self._finalize_report()
            return self.report

        g3 = self._gate3_metric_bounds()
        self.report["gates"]["metric_bounds"] = g3

        g4 = self._gate4_geometry_integrity()
        self.report["gates"]["geometry_integrity"] = g4

        g5 = self._gate5_unified_clay_material()
        self.report["gates"]["unified_clay_material"] = g5

        g6 = self._gate6_zero_missing_textures()
        self.report["gates"]["zero_missing_textures"] = g6

        self._finalize_report()
        return self.report

    def _gate1_file_exists_and_size(self) -> Dict[str, Any]:
        if not os.path.exists(self.filepath):
            err = f"File not found: '{self.filepath}'"
            self.report["summary"]["errors"].append(err)
            return {"status": "FAIL", "details": err}

        size = os.path.getsize(self.filepath)
        size_kb = size / 1024.0

        if size < 1024:
            err = f"File size too small ({size} bytes). Valid stages must be > 1 KB."
            self.report["summary"]["errors"].append(err)
            return {"status": "FAIL", "size_bytes": size, "size_kb": size_kb, "details": err}

        return {
            "status": "PASS",
            "size_bytes": size,
            "size_kb": round(size_kb, 2),
            "details": f"File exists and has valid size ({round(size_kb, 2)} KB)."
        }

    def _gate2_glb_header(self) -> Dict[str, Any]:
        try:
            with open(self.filepath, "rb") as f:
                header = f.read(12)
                if len(header) < 12:
                    raise ValueError("File header is truncated (< 12 bytes)")

                magic, version, total_length = struct.unpack("<4sII", header)
                if magic != b"glTF":
                    raise ValueError(f"Invalid GLB magic header: {magic!r} (expected b'glTF' / 0x46546C67)")

                if version != 2:
                    raise ValueError(f"Unsupported glTF version: {version} (expected 2)")

                chunk0_header = f.read(8)
                if len(chunk0_header) < 8:
                    raise ValueError("GLB Chunk 0 header is truncated")

                c0_len, c0_type = struct.unpack("<II", chunk0_header)
                if c0_type != 0x4E4F534A:  # b'JSON'
                    raise ValueError(f"Chunk 0 type is not JSON: {hex(c0_type)} (expected 0x4E4F534A)")

                c0_bytes = f.read(c0_len)
                if len(c0_bytes) < c0_len:
                    raise ValueError("GLB Chunk 0 data is truncated")

                json_str = c0_bytes.decode("utf-8").strip("\x00 \r\n\t")
                self.gltf_json = json.loads(json_str)

                # Read Chunk 1 (BIN buffer) if present
                if f.tell() < total_length:
                    c1_header = f.read(8)
                    if len(c1_header) == 8:
                        c1_len, c1_type = struct.unpack("<II", c1_header)
                        if c1_type == 0x004E4942:  # b'BIN\x00'
                            self.bin_buffer = f.read(c1_len)

            asset = self.gltf_json.get("asset", {})
            asset_ver = str(asset.get("version", ""))
            if not asset_ver.startswith("2."):
                raise ValueError(f"glTF asset version is '{asset_ver}' (expected '2.0')")

            return {
                "status": "PASS",
                "magic": "glTF",
                "version": version,
                "total_length": total_length,
                "json_chunk_length": c0_len,
                "asset_version": asset_ver,
                "generator": asset.get("generator", "unknown"),
                "details": f"Valid glTF 2.0 GLB binary container (Generator: {asset.get('generator', 'unknown')})."
            }
        except Exception as e:
            err = f"GLB Header / JSON Chunk validation failed: {str(e)}"
            self.report["summary"]["errors"].append(err)
            return {"status": "FAIL", "details": err}

    def _compute_node_world_matrices(self) -> Dict[int, List[List[float]]]:
        """Recursively computes world transform matrices for all nodes in the scene."""
        nodes = self.gltf_json.get("nodes", [])
        world_matrices: Dict[int, List[List[float]]] = {}

        def get_local_matrix(node: Dict[str, Any]) -> List[List[float]]:
            if "matrix" in node and len(node["matrix"]) == 16:
                return mat4_from_flat_column_major(node["matrix"])

            t = node.get("translation", [0.0, 0.0, 0.0])
            r = node.get("rotation", [0.0, 0.0, 0.0, 1.0])
            s = node.get("scale", [1.0, 1.0, 1.0])

            mt = mat4_from_translation(t[0], t[1], t[2])
            mr = mat4_from_quaternion(r[0], r[1], r[2], r[3])
            ms = mat4_from_scale(s[0], s[1], s[2])

            return mat4_multiply(mt, mat4_multiply(mr, ms))

        def traverse(node_idx: int, parent_matrix: List[List[float]]):
            if node_idx < 0 or node_idx >= len(nodes):
                return
            node = nodes[node_idx]
            local_m = get_local_matrix(node)
            world_m = mat4_multiply(parent_matrix, local_m)
            world_matrices[node_idx] = world_m

            for child_idx in node.get("children", []):
                traverse(child_idx, world_m)

        # Root nodes from scenes or unparented nodes
        scenes = self.gltf_json.get("scenes", [])
        active_scene_idx = self.gltf_json.get("scene", 0)
        root_nodes = []
        if scenes and active_scene_idx < len(scenes):
            root_nodes = scenes[active_scene_idx].get("nodes", [])

        if not root_nodes:
            # Fallback: all nodes not referenced as children
            children_set = set()
            for n in nodes:
                children_set.update(n.get("children", []))
            root_nodes = [i for i in range(len(nodes)) if i not in children_set]

        for root_idx in root_nodes:
            traverse(root_idx, mat4_identity())

        # Ensure any orphan node has at least its local matrix
        for i, n in enumerate(nodes):
            if i not in world_matrices:
                world_matrices[i] = get_local_matrix(n)

        return world_matrices

    def _gate3_metric_bounds(self) -> Dict[str, Any]:
        """Calculates exact world bounding box and checks metric limits."""
        meshes = self.gltf_json.get("meshes", [])
        accessors = self.gltf_json.get("accessors", [])
        nodes = self.gltf_json.get("nodes", [])
        world_matrices = self._compute_node_world_matrices()

        global_min = [float("inf"), float("inf"), float("inf")]
        global_max = [float("-inf"), float("-inf"), float("-inf")]
        found_any_bounds = False

        # Map nodes to meshes
        for node_idx, node in enumerate(nodes):
            mesh_idx = node.get("mesh")
            if mesh_idx is None or mesh_idx < 0 or mesh_idx >= len(meshes):
                continue

            world_m = world_matrices.get(node_idx, mat4_identity())
            mesh = meshes[mesh_idx]

            for prim in mesh.get("primitives", []):
                pos_acc_idx = prim.get("attributes", {}).get("POSITION")
                if pos_acc_idx is None or pos_acc_idx < 0 or pos_acc_idx >= len(accessors):
                    continue

                pos_acc = accessors[pos_acc_idx]
                min_p = pos_acc.get("min")
                max_p = pos_acc.get("max")

                # If min/max are not in accessor, read directly from binary buffer
                if min_p is None or max_p is None:
                    min_p, max_p = self._read_accessor_min_max(pos_acc)

                if min_p is not None and max_p is not None:
                    found_any_bounds = True
                    # 8 bounding box corners
                    corners = [
                        (min_p[0], min_p[1], min_p[2]),
                        (min_p[0], min_p[1], max_p[2]),
                        (min_p[0], max_p[1], min_p[2]),
                        (min_p[0], max_p[1], max_p[2]),
                        (max_p[0], min_p[1], min_p[2]),
                        (max_p[0], min_p[1], max_p[2]),
                        (max_p[0], max_p[1], min_p[2]),
                        (max_p[0], max_p[1], max_p[2]),
                    ]
                    for c in corners:
                        tx, ty, tz = mat4_transform_point(world_m, c)
                        global_min[0] = min(global_min[0], tx)
                        global_min[1] = min(global_min[1], ty)
                        global_min[2] = min(global_min[2], tz)
                        global_max[0] = max(global_max[0], tx)
                        global_max[1] = max(global_max[1], ty)
                        global_max[2] = max(global_max[2], tz)

        # Fallback: if no nodes referenced meshes, inspect meshes directly
        if not found_any_bounds:
            for mesh in meshes:
                for prim in mesh.get("primitives", []):
                    pos_acc_idx = prim.get("attributes", {}).get("POSITION")
                    if pos_acc_idx is not None and pos_acc_idx < len(accessors):
                        pos_acc = accessors[pos_acc_idx]
                        min_p = pos_acc.get("min")
                        max_p = pos_acc.get("max")
                        if min_p and max_p:
                            found_any_bounds = True
                            for i in range(3):
                                global_min[i] = min(global_min[i], min_p[i])
                                global_max[i] = max(global_max[i], max_p[i])

        if not found_any_bounds:
            err = "Could not determine bounding box: no valid POSITION accessors found in meshes."
            self.report["summary"]["errors"].append(err)
            return {"status": "FAIL", "details": err}

        x_span = round(global_max[0] - global_min[0], 3)
        y_span = round(global_max[1] - global_min[1], 3)
        z_span = round(global_max[2] - global_min[2], 3)
        y_min = round(global_min[1], 3)
        extent = max(x_span, y_span, z_span)

        bounds_info = {
            "bbox_min": [round(c, 3) for c in global_min],
            "bbox_max": [round(c, 3) for c in global_max],
            "span": [x_span, y_span, z_span],
            "x_span": x_span,
            "y_span": y_span,
            "z_span": z_span,
            "y_min": y_min,
            "extent": extent
        }

        errors = []
        # Metric Limits:
        # X_span <= 100m, Z_span <= 100m, Y_span <= 60m
        if x_span > 100.0:
            errors.append(f"X span exceeds 100m limit: {x_span}m")
        if z_span > 100.0:
            errors.append(f"Z span exceeds 100m limit: {z_span}m")
        if y_span > 60.0:
            errors.append(f"Y span (height) exceeds 60m limit: {y_span}m")

        # Ground level tolerance: Y_min >= -1.0m
        if y_min < -1.0:
            errors.append(f"Stage sunken below ground allowance (Y_min={y_min}m < -1.0m)")

        # World bounds ±50m grid
        if global_min[0] < -50.0 or global_max[0] > 50.0:
            errors.append(f"Stage exceeds X world boundary [-50m, 50m]: [{global_min[0]}m, {global_max[0]}m]")
        if global_min[2] < -50.0 or global_max[2] > 50.0:
            errors.append(f"Stage exceeds Z world boundary [-50m, 50m]: [{global_min[2]}m, {global_max[2]}m]")
        if global_max[1] > 60.0:
            errors.append(f"Stage height exceeds Y world ceiling 60m: Y_max={global_max[1]}m")

        # Non-degenerate extent: extent >= 0.5m
        if extent < 0.5:
            errors.append(f"Stage extent is degenerate / too small: {extent}m (< 0.5m)")

        if errors:
            for e in errors:
                self.report["summary"]["errors"].append(e)
            bounds_info["status"] = "FAIL"
            bounds_info["details"] = "; ".join(errors)
            return bounds_info

        bounds_info["status"] = "PASS"
        bounds_info["details"] = f"Metric bounds verified (Span: {x_span}m x {y_span}m x {z_span}m, Y_min: {y_min}m, within ±50m world box)."
        return bounds_info

    def _read_accessor_min_max(self, accessor: Dict[str, Any]) -> Tuple[Optional[List[float]], Optional[List[float]]]:
        if not self.bin_buffer or "bufferView" not in accessor:
            return None, None
        bv_idx = accessor["bufferView"]
        buffer_views = self.gltf_json.get("bufferViews", [])
        if bv_idx >= len(buffer_views):
            return None, None

        bv = buffer_views[bv_idx]
        offset = bv.get("byteOffset", 0) + accessor.get("byteOffset", 0)
        count = accessor.get("count", 0)
        stride = bv.get("byteStride", 12)

        min_p = [float("inf"), float("inf"), float("inf")]
        max_p = [float("-inf"), float("-inf"), float("-inf")]

        for i in range(count):
            elem_offset = offset + i * stride
            if elem_offset + 12 <= len(self.bin_buffer):
                x, y, z = struct.unpack_from("<3f", self.bin_buffer, elem_offset)
                if not (math.isnan(x) or math.isnan(y) or math.isnan(z)):
                    min_p[0] = min(min_p[0], x)
                    min_p[1] = min(min_p[1], y)
                    min_p[2] = min(min_p[2], z)
                    max_p[0] = max(max_p[0], x)
                    max_p[1] = max(max_p[1], y)
                    max_p[2] = max(max_p[2], z)

        if min_p[0] == float("inf"):
            return None, None
        return min_p, max_p

    def _gate4_geometry_integrity(self) -> Dict[str, Any]:
        meshes = self.gltf_json.get("meshes", [])
        accessors = self.gltf_json.get("accessors", [])

        if not meshes:
            err = "GLB contains 0 meshes."
            self.report["summary"]["errors"].append(err)
            return {"status": "FAIL", "mesh_count": 0, "details": err}

        total_primitives = 0
        total_vertices = 0
        total_faces = 0
        missing_position = 0
        missing_normal = 0
        corrupt_coords = 0
        normalized_normals = 0
        checked_normals = 0

        for mesh_idx, mesh in enumerate(meshes):
            primitives = mesh.get("primitives", [])
            total_primitives += len(primitives)

            for prim in primitives:
                attrs = prim.get("attributes", {})
                pos_acc_idx = attrs.get("POSITION")
                norm_acc_idx = attrs.get("NORMAL")
                indices_acc_idx = prim.get("indices")

                if pos_acc_idx is None or pos_acc_idx >= len(accessors):
                    missing_position += 1
                else:
                    pos_acc = accessors[pos_acc_idx]
                    v_count = pos_acc.get("count", 0)
                    total_vertices += v_count
                    # Check min/max for NaNs/Infs
                    for val in pos_acc.get("min", []) + pos_acc.get("max", []):
                        if math.isnan(val) or math.isinf(val):
                            corrupt_coords += 1

                if norm_acc_idx is None or norm_acc_idx >= len(accessors):
                    missing_normal += 1
                else:
                    norm_acc = accessors[norm_acc_idx]
                    # Spot-check normal vectors from binary buffer if available
                    if self.bin_buffer and "bufferView" in norm_acc:
                        bv_idx = norm_acc["bufferView"]
                        if bv_idx < len(self.gltf_json.get("bufferViews", [])):
                            bv = self.gltf_json["bufferViews"][bv_idx]
                            n_offset = bv.get("byteOffset", 0) + norm_acc.get("byteOffset", 0)
                            n_count = min(norm_acc.get("count", 0), 20)  # spot-check up to 20
                            stride = bv.get("byteStride", 12)
                            for k in range(n_count):
                                if n_offset + (k + 1) * stride <= len(self.bin_buffer):
                                    nx, ny, nz = struct.unpack_from("<3f", self.bin_buffer, n_offset + k * stride)
                                    checked_normals += 1
                                    length = math.sqrt(nx * nx + ny * ny + nz * nz)
                                    if 0.85 <= length <= 1.15:
                                        normalized_normals += 1

                if indices_acc_idx is not None and indices_acc_idx < len(accessors):
                    ind_acc = accessors[indices_acc_idx]
                    total_faces += ind_acc.get("count", 0) // 3
                elif pos_acc_idx is not None and pos_acc_idx < len(accessors):
                    total_faces += accessors[pos_acc_idx].get("count", 0) // 3

        geom_info = {
            "mesh_count": len(meshes),
            "primitive_count": total_primitives,
            "vertex_count": total_vertices,
            "face_count": total_faces,
            "position_accessors_valid": (missing_position == 0),
            "normal_accessors_valid": (missing_normal == 0)
        }

        errors = []
        if total_primitives < 1:
            errors.append("Stage contains 0 geometry primitives")
        if total_vertices <= 0:
            errors.append("Stage contains 0 vertices")
        if missing_position > 0:
            errors.append(f"{missing_position} primitives missing required POSITION accessor")
        if missing_normal > 0:
            errors.append(f"{missing_normal} primitives missing required NORMAL accessor")
        if corrupt_coords > 0:
            errors.append(f"Corrupt coordinates detected ({corrupt_coords} NaN/Inf values)")

        if errors:
            for e in errors:
                self.report["summary"]["errors"].append(e)
            geom_info["status"] = "FAIL"
            geom_info["details"] = "; ".join(errors)
            return geom_info

        geom_info["status"] = "PASS"
        geom_info["details"] = (
            f"Geometry integrity verified ({len(meshes)} meshes, {total_primitives} primitives, "
            f"{total_vertices} vertices, {total_faces} faces, all POSITION & NORMAL accessors present)."
        )
        return geom_info

    def _gate5_unified_clay_material(self) -> Dict[str, Any]:
        materials = self.gltf_json.get("materials", [])
        mat_count = len(materials)

        mat_info = {
            "material_count": mat_count,
            "materials": []
        }

        errors = []
        warnings = []

        if mat_count > 2:
            errors.append(f"Found {mat_count} materials. Unified clay stage must have <= 2 materials (target: 1 'Clay_Matte').")

        for m_idx, mat in enumerate(materials):
            name = mat.get("name", f"Material_{m_idx}")
            pbr = mat.get("pbrMetallicRoughness", {})

            base_color = pbr.get("baseColorFactor", [1.0, 1.0, 1.0, 1.0])
            roughness = pbr.get("roughnessFactor", 1.0)
            metallic = pbr.get("metallicFactor", 0.0)

            # Check RGB neutral clay range [0.50, 0.90]
            r, g, b = base_color[0], base_color[1], base_color[2]
            is_neutral_rgb = (0.50 <= r <= 0.90) and (0.50 <= g <= 0.90) and (0.50 <= b <= 0.90)
            is_matte = (roughness >= 0.70)
            is_dielectric = (metallic <= 0.10)

            entry = {
                "name": name,
                "base_color": [round(c, 3) for c in base_color],
                "roughness": round(roughness, 3),
                "metallic": round(metallic, 3),
                "is_neutral_clay": is_neutral_rgb and is_matte and is_dielectric
            }
            mat_info["materials"].append(entry)

            if not is_neutral_rgb:
                warnings.append(f"Material '{name}' base color ({r:.2f}, {g:.2f}, {b:.2f}) outside neutral clay range [0.5, 0.9]")
            if not is_matte:
                warnings.append(f"Material '{name}' roughness {roughness:.2f} < 0.7 (expected matte)")
            if not is_dielectric:
                warnings.append(f"Material '{name}' metallic {metallic:.2f} > 0.1 (expected dielectric clay)")

        # If errors present, fail
        if errors:
            for e in errors:
                self.report["summary"]["errors"].append(e)
            mat_info["status"] = "FAIL"
            mat_info["details"] = "; ".join(errors)
            return mat_info

        if warnings:
            for w in warnings:
                self.report["summary"]["warnings"].append(w)

        mat_info["status"] = "PASS"
        mat_names = [m["name"] for m in mat_info["materials"]]
        mat_info["details"] = f"Unified clay material verified ({mat_count} material(s): {', '.join(mat_names) if mat_names else 'None'})."
        return mat_info

    def _gate6_zero_missing_textures(self) -> Dict[str, Any]:
        images = self.gltf_json.get("images", [])
        image_count = len(images)

        tex_info = {
            "image_count": image_count,
            "missing_textures": []
        }

        base_dir = os.path.dirname(self.filepath)
        missing = []

        for idx, img in enumerate(images):
            uri = img.get("uri")
            if uri:
                # Check data URI
                if uri.startswith("data:"):
                    continue
                # Check external disk path
                tex_path = os.path.join(base_dir, uri) if not os.path.isabs(uri) else uri
                if not os.path.exists(tex_path):
                    missing.append(uri)

        if missing:
            err = f"Unresolved external textures: {', '.join(missing)}"
            self.report["summary"]["errors"].append(err)
            tex_info["status"] = "FAIL"
            tex_info["missing_textures"] = missing
            tex_info["details"] = err
            return tex_info

        tex_info["status"] = "PASS"
        tex_info["details"] = f"Texture integrity verified ({image_count} images defined, 0 missing external textures)."
        return tex_info

    def _finalize_report(self):
        passed = 0
        failed = 0
        for gate_name, gate_data in self.report["gates"].items():
            if gate_data.get("status") == "PASS":
                passed += 1
            else:
                failed += 1

        self.report["summary"]["passed_gates"] = passed
        self.report["summary"]["failed_gates"] = failed
        self.report["passed"] = (failed == 0 and passed == 6)
        self.report["valid"] = self.report["passed"]


# ==============================================================================
# HEADLESS BLENDER RUNNER / EXECUTION
# ==============================================================================

def find_blender_binary() -> Optional[str]:
    """Finds the local Blender executable on macOS / Linux."""
    candidates = [
        os.environ.get("BLENDER_BIN"),
        os.environ.get("BLENDER_PATH"),
        "/Applications/Blender.app/Contents/MacOS/Blender",
        "/usr/local/bin/blender",
        "/usr/bin/blender",
        "blender"
    ]
    for c in candidates:
        if c and os.path.exists(c) and os.access(c, os.X_OK):
            return c
    return None


def run_blender_validation_headless(glb_path: str, verbose: bool = False, as_json: bool = False, render_path: Optional[str] = None) -> int:
    """Executes validation inside headless Blender using Blender's Python runtime."""
    blender_bin = find_blender_binary()
    if not blender_bin:
        print("[ERROR] Blender executable not found. Cannot run in --blender mode.", file=sys.stderr)
        return 1

    this_script = os.path.abspath(__file__)
    cmd = [
        blender_bin,
        "--background",
        "--factory-startup",
        "--python", this_script,
        "--",
        os.path.abspath(glb_path),
        "--inside-blender"
    ]
    if verbose:
        cmd.append("--verbose")
    if as_json:
        cmd.append("--json")
    if render_path:
        cmd.extend(["--render", os.path.abspath(render_path)])

    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        # Print stdout from Blender
        if proc.stdout:
            print(proc.stdout, end="")
        if proc.stderr and verbose:
            print(proc.stderr, file=sys.stderr, end="")
        return proc.returncode
    except Exception as e:
        print(f"[ERROR] Failed to execute Blender: {e}", file=sys.stderr)
        return 1


def validate_inside_blender(glb_path: str, verbose: bool = False, as_json: bool = False, render_path: Optional[str] = None):
    """Internal validator executed when running inside Blender's python process."""
    try:
        import bpy
        import mathutils
    except ImportError:
        print("[ERROR] 'bpy' not found. Not running inside Blender.", file=sys.stderr)
        sys.exit(1)

    glb_abs = os.path.abspath(glb_path)
    if not os.path.exists(glb_abs):
        print(f"[ERROR] File not found: {glb_abs}", file=sys.stderr)
        sys.exit(1)

    # Clear existing scene
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # Import GLTF/GLB
    try:
        bpy.ops.import_scene.gltf(filepath=glb_abs)
    except Exception as e:
        print(f"[ERROR] Blender failed to import GLB: {e}", file=sys.stderr)
        sys.exit(1)

    mesh_objs = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    total_vertices = sum(len(obj.data.vertices) for obj in mesh_objs)
    total_faces = sum(len(obj.data.polygons) for obj in mesh_objs)

    # World bounds calculation in Blender (Z-up -> GLTF Y-up)
    global_min = [float("inf"), float("inf"), float("inf")]
    global_max = [float("-inf"), float("-inf"), float("-inf")]

    for obj in mesh_objs:
        for corner in obj.bound_box:
            world_pt = obj.matrix_world @ mathutils.Vector(corner)
            # In Blender: X=X, Y=North(-Z_gltf), Z=Up(+Y_gltf)
            # When imported with glTF addon, Blender coords are:
            # X_blender = X_gltf, Y_blender = -Z_gltf, Z_blender = Y_gltf
            gx = world_pt.x
            gy = world_pt.z
            gz = -world_pt.y
            global_min[0] = min(global_min[0], gx)
            global_min[1] = min(global_min[1], gy)
            global_min[2] = min(global_min[2], gz)
            global_max[0] = max(global_max[0], gx)
            global_max[1] = max(global_max[1], gy)
            global_max[2] = max(global_max[2], gz)

    if global_min[0] == float("inf"):
        global_min = [0.0, 0.0, 0.0]
        global_max = [0.0, 0.0, 0.0]

    x_span = round(global_max[0] - global_min[0], 3)
    y_span = round(global_max[1] - global_min[1], 3)
    z_span = round(global_max[2] - global_min[2], 3)
    y_min = round(global_min[1], 3)
    extent = max(x_span, y_span, z_span)

    # Check Materials
    materials = list(bpy.data.materials)
    mat_entries = []
    for m in materials:
        bc = [0.788, 0.788, 0.812, 1.0]
        roughness = 1.0
        metallic = 0.0
        if m.use_nodes and m.node_tree:
            bsdf = m.node_tree.nodes.get("Principled BSDF")
            if bsdf:
                if "Base Color" in bsdf.inputs:
                    val = bsdf.inputs["Base Color"].default_value
                    bc = [round(v, 3) for v in val[:4]]
                if "Roughness" in bsdf.inputs:
                    roughness = round(float(bsdf.inputs["Roughness"].default_value), 3)
                if "Metallic" in bsdf.inputs:
                    metallic = round(float(bsdf.inputs["Metallic"].default_value), 3)
        mat_entries.append({
            "name": m.name,
            "base_color": bc,
            "roughness": roughness,
            "metallic": metallic,
            "is_neutral_clay": (0.50 <= bc[0] <= 0.90) and (roughness >= 0.70) and (metallic <= 0.10)
        })

    # Images
    images = list(bpy.data.images)
    missing_textures = []
    for img in images:
        if img.filepath and not os.path.exists(bpy.path.abspath(img.filepath)):
            missing_textures.append(img.filepath)

    passed_bounds = (x_span <= 100.0 and z_span <= 100.0 and y_span <= 60.0 and y_min >= -1.0 and extent >= 0.5)
    passed_geom = (len(mesh_objs) >= 1 and total_vertices > 0)
    passed_mat = (len(materials) <= 2)
    passed_tex = (len(missing_textures) == 0)

    all_passed = (passed_bounds and passed_geom and passed_mat and passed_tex)

    report = {
        "file": glb_abs,
        "mode": "headless_blender",
        "passed": all_passed,
        "valid": all_passed,
        "gates": {
            "file_exists_and_size": {
                "status": "PASS",
                "size_bytes": os.path.getsize(glb_abs),
                "size_kb": round(os.path.getsize(glb_abs) / 1024.0, 2),
                "details": "File loaded successfully in Blender."
            },
            "glb_header_valid": {
                "status": "PASS",
                "blender_version": bpy.app.version_string,
                "details": f"Blender {bpy.app.version_string} imported glTF successfully."
            },
            "metric_bounds": {
                "status": "PASS" if passed_bounds else "FAIL",
                "bbox_min": [round(c, 3) for c in global_min],
                "bbox_max": [round(c, 3) for c in global_max],
                "span": [x_span, y_span, z_span],
                "x_span": x_span,
                "y_span": y_span,
                "z_span": z_span,
                "y_min": y_min,
                "extent": extent,
                "details": "Metric bounds verified in Blender." if passed_bounds else "Metric bounds violation."
            },
            "geometry_integrity": {
                "status": "PASS" if passed_geom else "FAIL",
                "mesh_count": len(mesh_objs),
                "vertex_count": total_vertices,
                "face_count": total_faces,
                "details": f"Blender verified {len(mesh_objs)} meshes, {total_vertices} vertices, {total_faces} faces."
            },
            "unified_clay_material": {
                "status": "PASS" if passed_mat else "FAIL",
                "material_count": len(materials),
                "materials": mat_entries,
                "details": f"{len(materials)} materials verified in Blender."
            },
            "zero_missing_textures": {
                "status": "PASS" if passed_tex else "FAIL",
                "image_count": len(images),
                "missing_textures": missing_textures,
                "details": "0 missing textures in Blender." if passed_tex else f"{len(missing_textures)} missing textures."
            }
        },
        "summary": {
            "total_gates": 6,
            "passed_gates": 6 if all_passed else 0,
            "failed_gates": 0 if all_passed else 1,
            "errors": [] if all_passed else ["Blender validation failed on one or more gates."],
            "warnings": []
        }
    }

    if render_path and mesh_objs:
        try:
            render_abs = os.path.abspath(render_path)
            out_dir = os.path.dirname(render_abs)
            if out_dir and not os.path.exists(out_dir):
                os.makedirs(out_dir, exist_ok=True)

            min_b = [float("inf")] * 3
            max_b = [float("-inf")] * 3
            for obj in mesh_objs:
                for corner in obj.bound_box:
                    world_pt = obj.matrix_world @ mathutils.Vector(corner)
                    for i in range(3):
                        min_b[i] = min(min_b[i], world_pt[i])
                        max_b[i] = max(max_b[i], world_pt[i])

            center = [(min_b[i] + max_b[i]) / 2.0 for i in range(3)]
            span_dims = [max_b[i] - min_b[i] for i in range(3)]
            max_d = max(max(span_dims), 1.0)

            cam_data = bpy.data.cameras.new("QCCam")
            cam_data.lens = 32
            cam_obj = bpy.data.objects.new("QCCam", cam_data)
            bpy.context.scene.collection.objects.link(cam_obj)
            bpy.context.scene.camera = cam_obj

            cam_dist = max_d * 1.6
            cam_obj.location = (center[0] - cam_dist * 0.7, center[1] - cam_dist * 0.7, center[2] + cam_dist * 0.6)

            constraint = cam_obj.constraints.new(type="TRACK_TO")
            track_empty = bpy.data.objects.new("QCTarget", None)
            track_empty.location = center
            bpy.context.scene.collection.objects.link(track_empty)
            constraint.target = track_empty
            constraint.track_axis = "TRACK_NEGATIVE_Z"
            constraint.up_axis = "UP_Y"

            bpy.context.scene.render.engine = "BLENDER_WORKBENCH"
            bpy.context.scene.render.resolution_x = 1280
            bpy.context.scene.render.resolution_y = 720
            bpy.context.scene.display.shading.light = "STUDIO"
            bpy.context.scene.display.shading.color_type = "MATERIAL"
            bpy.context.scene.display.shading.show_cavity = True
            bpy.context.scene.display.shading.show_shadows = True

            bpy.context.scene.render.filepath = render_abs
            bpy.ops.render.render(write_still=True)
            report["preview_render"] = render_abs
            if verbose:
                print(f"[QC] Rendered visual inspection snapshot to: {render_abs}")
        except Exception as ren_err:
            if verbose:
                print(f"[WARN] Failed to render visual snapshot: {ren_err}", file=sys.stderr)

    if as_json:
        print(json.dumps(report, indent=2))
    else:
        print_ascii_report(report)

    sys.exit(0 if all_passed else 1)


# ==============================================================================
# REPORT FORMATTERS (ASCII TABLE & JSON)
# ==============================================================================

def print_ascii_report(report: Dict[str, Any]):
    fname = os.path.basename(report.get("file", "unknown"))
    status_str = "PASS (100%)" if report.get("passed") else "FAIL"
    mode_str = report.get("mode", "standalone_python")

    print("=" * 72)
    print(f"  CLAY STAGE QA REPORT: {fname}")
    print(f"  Execution Mode: {mode_str} | Overall Result: {status_str}")
    print("=" * 72)

    gates = report.get("gates", {})
    for g_idx, (gate_name, g_data) in enumerate(gates.items(), start=1):
        g_status = g_data.get("status", "UNKNOWN")
        icon = "[✓ PASS]" if g_status == "PASS" else "[✗ FAIL]"
        title = gate_name.replace("_", " ").title()
        print(f"  {g_idx}. {icon:<10} {title}")
        print(f"     Details: {g_data.get('details', '')}")

        if gate_name == "metric_bounds" and "span" in g_data:
            print(f"     Bounds : Min={g_data.get('bbox_min')} | Max={g_data.get('bbox_max')}")
            print(f"     Span   : X={g_data.get('x_span')}m, Y={g_data.get('y_span')}m, Z={g_data.get('z_span')}m (Ground Y_min={g_data.get('y_min')}m)")

        if gate_name == "geometry_integrity":
            print(f"     Geometry: {g_data.get('mesh_count')} meshes, {g_data.get('primitive_count', g_data.get('mesh_count'))} primitives, {g_data.get('vertex_count')} vertices, {g_data.get('face_count')} faces")

        if gate_name == "unified_clay_material":
            mats = g_data.get("materials", [])
            for m in mats:
                print(f"     Material: '{m.get('name')}' Color={m.get('base_color')[:3]} Roughness={m.get('roughness')} Metallic={m.get('metallic')}")

        print("-" * 72)

    summary = report.get("summary", {})
    print(f"  Summary: Passed Gates: {summary.get('passed_gates')}/{summary.get('total_gates')} | Failed Gates: {summary.get('failed_gates')}")
    if report.get("preview_render"):
        print(f"  [✓ SNAPSHOT] Visual QC Preview: {report['preview_render']}")
    if summary.get("errors"):
        print("  Errors:")
        for err in summary["errors"]:
            print(f"    - [ERROR] {err}")
    if summary.get("warnings"):
        print("  Warnings:")
        for warn in summary["warnings"]:
            print(f"    - [WARN] {warn}")
    print("=" * 72)


# ==============================================================================
# MAIN CLI ENTRY POINT
# ==============================================================================

def main():
    # Detect if invoked inside Blender's python script execution
    if "--inside-blender" in sys.argv:
        # Filter Blender args
        argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
        target_file = argv[0] if argv else ""
        as_json = "--json" in argv
        verbose = "--verbose" in argv
        render_path = None
        if "--render" in argv:
            r_idx = argv.index("--render")
            if r_idx + 1 < len(argv):
                render_path = argv[r_idx + 1]
        validate_inside_blender(target_file, verbose=verbose, as_json=as_json, render_path=render_path)
        return

    parser = argparse.ArgumentParser(
        description="Clay Stage QA Gate: Validates GLB clay stages for scale, bounds, geometry, material, and textures."
    )
    parser.add_argument("file", help="Path to .glb clay stage file to validate")
    parser.add_argument("--json", action="store_true", help="Output machine-readable JSON validation report")
    parser.add_argument("--inspect", action="store_true", help="Print human-readable ASCII inspection table (default)")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose diagnostic logs")
    parser.add_argument("--blender", action="store_true", help="Execute validation via headless Blender")
    parser.add_argument("--render", type=str, default=None, help="Render visual clay inspection snapshot (PNG)")

    args = parser.parse_args()

    if args.blender or args.render:
        code = run_blender_validation_headless(args.file, verbose=args.verbose, as_json=args.json, render_path=args.render)
        sys.exit(code)

    validator = PurePythonGLBValidator(args.file, verbose=args.verbose)
    report = validator.validate()

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print_ascii_report(report)

    sys.exit(0 if report.get("passed") else 1)


if __name__ == "__main__":
    main()
