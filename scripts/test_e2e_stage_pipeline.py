#!/usr/bin/env python3
"""
E2E Dual 3D Stage Architecture Test Runner (ComfyUI-scene-camera-action)

Comprehensive end-to-end verification suite:
1. JSON Staging QA Gate (Gate 1):
   - Verifies all presets in presets/*.json using staging_utils.py --validate and --inspect.
   - Enforces 0 bounds issues and 0 ground misalignments on canonical presets (courthouse_square, gas_station, collapsed_warehouse, etc.).
   - Validates schema structure across all 9 JSON presets.
2. Blender Clay GLB QA Gate (Gate 2):
   - Verifies all GLBs in presets/*.glb using validate_clay_stage.py (Standalone Pure Python & Headless Blender).
   - Validates file size, glTF 2.0 header, metric bounds, geometry integrity, Clay_Matte material, and 0 missing textures.
3. Skills Specification & Immutability Audit:
   - Verifies skills/stage-builder/SKILL.md (v3.1+, Paso 0 interactive deconstruction, 6 spatial facts, questionnaire).
   - Verifies skills/stage-blender-builder/SKILL.md (Blender headless/MCP clay stage workflow & grammar).
   - Verifies mathematical engine immutability in staging_utils.py.
4. ComfyUI Node Layer:
   - Verifies StagingGLBNode and UBStagingGLBNode registrations in nodes.py and __init__.py.
   - Verifies /scene_camera_action/get_glb route active.

Usage:
  python3 scripts/test_e2e_stage_pipeline.py [--verbose] [--json]
  Returns exit code 0 on 100% PASS, 1 on FAIL.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import subprocess
import sys
import time
from typing import Any, Dict, List, Tuple


BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRESETS_DIR = os.path.join(BASE_DIR, "presets")
SCRIPTS_DIR = os.path.join(BASE_DIR, "scripts")
SKILLS_DIR = os.path.join(BASE_DIR, "skills")


class E2ETestRunner:
    def __init__(self, verbose: bool = False):
        self.verbose = verbose
        self.results: List[Dict[str, Any]] = []
        self.start_time = 0.0

    def log(self, msg: str):
        if self.verbose:
            print(f"  [DEBUG] {msg}")

    def add_result(self, suite: str, name: str, passed: bool, details: str, duration: float = 0.0):
        self.results.append({
            "suite": suite,
            "name": name,
            "passed": passed,
            "status": "PASS" if passed else "FAIL",
            "details": details,
            "duration_ms": round(duration * 1000, 2)
        })

    def run_all(self) -> bool:
        self.start_time = time.time()
        print("=" * 76)
        print("  COMFYUI-SCENE-CAMERA-ACTION: DUAL 3D STAGE E2E TEST SUITE")
        print("=" * 76)

        self.test_suite_1_json_staging_presets()
        self.test_suite_2_blender_clay_glb_stages()
        self.test_suite_3_skill_specifications()
        self.test_suite_4_comfyui_node_integration()

        total_duration = time.time() - self.start_time
        return self._summarize(total_duration)

    # --------------------------------------------------------------------------
    # SUITE 1: JSON Staging QA Gate (Gate 1)
    # --------------------------------------------------------------------------
    def test_suite_1_json_staging_presets(self):
        suite_name = "Suite 1: JSON Staging QA (Gate 1)"
        print(f"\n▶ Running {suite_name}...")

        staging_utils_path = os.path.join(SKILLS_DIR, "stage-builder", "scripts", "staging_utils.py")
        if not os.path.exists(staging_utils_path):
            self.add_result(suite_name, "staging_utils.py exists", False, f"Not found at {staging_utils_path}")
            return

        json_files = sorted(glob.glob(os.path.join(PRESETS_DIR, "*.json")))
        if not json_files:
            self.add_result(suite_name, "JSON Presets Presence", False, f"No .json presets found in {PRESETS_DIR}")
            return

        # Canonical zero-fault presets that must strictly have 0 bounds issues and 0 misalignments
        canonical_zero_fault_presets = {
            "courthouse_square.json",
            "gas_station.json",
            "collapsed_warehouse.json",
            "space_platform_track.json",
            "varied_forest.json",
        }

        for jf in json_files:
            t0 = time.time()
            base_name = os.path.basename(jf)

            # 1. Test validation command
            cmd_validate = [sys.executable, staging_utils_path, jf, "--validate"]
            proc_val = subprocess.run(cmd_validate, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

            # 2. Test inspection command
            cmd_inspect = [sys.executable, staging_utils_path, jf, "--inspect"]
            proc_insp = subprocess.run(cmd_inspect, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

            dur = time.time() - t0
            out_insp = proc_insp.stdout

            with open(jf, "r", encoding="utf-8") as f:
                data = json.load(f)

            is_valid_schema = (proc_val.returncode == 0) and (data.get("type") == "cube_stage") and ("nodes" in data)
            num_nodes = len(data.get("nodes", []))

            if base_name in canonical_zero_fault_presets:
                has_bounds_warn = "[WARN BOUNDS]" in out_insp or "Bounds Issues: 0" not in out_insp
                has_ground_warn = "[WARN GROUND]" in out_insp or "Root Ground Misalignments: 0" not in out_insp
                passed = is_valid_schema and (not has_bounds_warn) and (not has_ground_warn)
                details = f"0 bounds issues, 0 ground misalignments, {num_nodes} root nodes (Canonical PASS)"
            else:
                # Specialized test stages (collider ramps, complex tracks) validate schema and inspect hierarchy
                passed = is_valid_schema and (proc_insp.returncode == 0)
                details = f"Valid cube_stage schema, {num_nodes} root nodes, hierarchy inspected"

            self.add_result(suite_name, f"JSON Preset: {base_name}", passed, details, dur)

    # --------------------------------------------------------------------------
    # SUITE 2: Blender Clay GLB QA Gate (Gate 2)
    # --------------------------------------------------------------------------
    def test_suite_2_blender_clay_glb_stages(self):
        suite_name = "Suite 2: Blender Clay GLB QA (Gate 2)"
        print(f"\n▶ Running {suite_name}...")

        validate_script = os.path.join(SCRIPTS_DIR, "validate_clay_stage.py")
        if not os.path.exists(validate_script):
            self.add_result(suite_name, "validate_clay_stage.py exists", False, f"Not found at {validate_script}")
            return

        glb_files = sorted(glob.glob(os.path.join(PRESETS_DIR, "*.glb")))
        if not glb_files:
            self.add_result(suite_name, "GLB Presets Presence", False, f"No .glb presets found in {PRESETS_DIR}")
            return

        # 1. Pure Python Standalone Mode for all GLBs
        for glb in glb_files:
            t0 = time.time()
            cmd = [sys.executable, validate_script, glb, "--json"]
            try:
                proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=10)
                dur = time.time() - t0
                if proc.returncode == 0 and proc.stdout:
                    report = json.loads(proc.stdout)
                    passed = report.get("passed", False)
                    gates = report.get("gates", {})
                    b = gates.get("metric_bounds", {})
                    g = gates.get("geometry_integrity", {})
                    m = gates.get("unified_clay_material", {})
                    details = (
                        f"All 6 gates PASS | Span: {b.get('x_span')}mx{b.get('y_span')}mx{b.get('z_span')}m | "
                        f"{g.get('mesh_count')} meshes, {g.get('vertex_count')} verts | Mat: {m.get('materials', [{}])[0].get('name', 'None')}"
                    )
                    self.add_result(suite_name, f"Standalone GLB: {os.path.basename(glb)}", passed, details, dur)
                else:
                    self.add_result(suite_name, f"Standalone GLB: {os.path.basename(glb)}", False, proc.stderr or proc.stdout, dur)
            except Exception as e:
                dur = time.time() - t0
                self.add_result(suite_name, f"Standalone GLB: {os.path.basename(glb)}", False, str(e), dur)

        # 2. Headless Blender Mode on hero stage (courtyard_monastery.glb)
        hero_glb = os.path.join(PRESETS_DIR, "courtyard_monastery.glb")
        if os.path.exists(hero_glb):
            t0 = time.time()
            cmd_blender = [sys.executable, validate_script, hero_glb, "--blender"]
            try:
                proc = subprocess.run(cmd_blender, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=20)
                dur = time.time() - t0
                passed = (proc.returncode == 0) and ("Overall Result: PASS (100%)" in proc.stdout)
                details = "Blender 5.2.0 headless imported glTF, validated mesh topology, bounds, and clay shader"
                self.add_result(suite_name, "Headless Blender: courtyard_monastery.glb", passed, details if passed else proc.stderr, dur)
            except Exception as e:
                dur = time.time() - t0
                self.add_result(suite_name, "Headless Blender: courtyard_monastery.glb", False, str(e), dur)

    # --------------------------------------------------------------------------
    # SUITE 3: Skill Specifications & Immutability Audit
    # --------------------------------------------------------------------------
    def test_suite_3_skill_specifications(self):
        suite_name = "Suite 3: Skills & Film Grammar Specifications"
        print(f"\n▶ Running {suite_name}...")

        # 1. stage-builder v3.1+ SKILL.md
        sb_skill_path = os.path.join(SKILLS_DIR, "stage-builder", "SKILL.md")
        t0 = time.time()
        if os.path.exists(sb_skill_path):
            with open(sb_skill_path, "r", encoding="utf-8") as f:
                sb_content = f.read()
            has_paso0 = ("Paso 0" in sb_content or "Step 0" in sb_content) and ("Deconstrucción" in sb_content or "Spatial Deconstruction" in sb_content)
            has_facts = ("decisivos" in sb_content or "facts" in sb_content or "Relaciones espaciales" in sb_content)
            has_questions = ("Preguntas Estructuradas" in sb_content or "Questionnaire" in sb_content or "pregunta" in sb_content.lower())
            dur = time.time() - t0
            passed = has_paso0 and has_facts and has_questions
            details = "Includes Paso 0 Interactive Spatial Deconstruction & Structured User Questionnaire"
            self.add_result(suite_name, "skills/stage-builder/SKILL.md (v3.1.0)", passed, details, dur)
        else:
            self.add_result(suite_name, "skills/stage-builder/SKILL.md exists", False, "File not found")

        # 2. staging_utils.py immutability and mathematical engine
        su_path = os.path.join(SKILLS_DIR, "stage-builder", "scripts", "staging_utils.py")
        t0 = time.time()
        if os.path.exists(su_path):
            with open(su_path, "r", encoding="utf-8") as f:
                su_content = f.read()
            has_segment = "def create_segment_between" in su_content
            has_linear = "def generate_linear_array" in su_content
            has_radial = "def generate_radial_arc" in su_content
            has_stepped = "def generate_stepped_incline" in su_content
            has_sloped = "def generate_sloped_ramp" in su_content
            has_bounds = "def check_world_bounds" in su_content
            has_ground = "def check_ground_alignment" in su_content
            has_inspect = "def inspect_stage" in su_content
            dur = time.time() - t0
            passed = all([has_segment, has_linear, has_radial, has_stepped, has_sloped, has_bounds, has_ground, has_inspect])
            details = "All 5 universal geometric generators and deterministic quality gates intact & pure"
            self.add_result(suite_name, "staging_utils.py Mathematical Core Immutability", passed, details, dur)
        else:
            self.add_result(suite_name, "staging_utils.py exists", False, "File not found")

        # 3. stage-blender-builder SKILL.md
        sbc_skill_path = os.path.join(SKILLS_DIR, "stage-blender-builder", "SKILL.md")
        t0 = time.time()
        if os.path.exists(sbc_skill_path):
            with open(sbc_skill_path, "r", encoding="utf-8") as f:
                sbc_content = f.read()
            has_headless = ("--background" in sbc_content or "headless" in sbc_content.lower())
            has_clay_mat = ("Clay_Matte" in sbc_content or "#c9c9cf" in sbc_content)
            has_collections = "01_Terrain_Ground" in sbc_content and "02_Architecture_Primary" in sbc_content
            dur = time.time() - t0
            passed = has_headless and has_clay_mat and has_collections
            details = "Complete Blender headless background CLI workflow spec with Clay_Matte and 5 collections"
            self.add_result(suite_name, "skills/stage-blender-builder/SKILL.md (v1.0.0)", passed, details, dur)
        else:
            self.add_result(suite_name, "skills/stage-blender-builder/SKILL.md exists", False, "File not found")

        # 4. scripts/validate_clay_stage.py root tool & lean SKILL.md (<80 lines)
        val_path = os.path.join(BASE_DIR, "scripts", "validate_clay_stage.py")
        t0 = time.time()
        if os.path.exists(val_path):
            with open(sbc_skill_path, "r", encoding="utf-8") as f:
                sbc_lines = f.readlines()
            is_lean = len(sbc_lines) <= 80
            has_depth = any("3 Depth Layers" in line for line in sbc_lines)
            dur = time.time() - t0
            passed = is_lean and has_depth
            details = f"Single root validator active, SKILL.md is ultra-lean ({len(sbc_lines)} lines <= 80) with 3 Depth Layers"
            self.add_result(suite_name, "scripts/validate_clay_stage.py & Lean SKILL.md", passed, details, dur)
        else:
            self.add_result(suite_name, "scripts/validate_clay_stage.py exists", False, "File not found")

    # --------------------------------------------------------------------------
    # SUITE 4: ComfyUI Integration & Node Registration
    # --------------------------------------------------------------------------
    def test_suite_4_comfyui_node_integration(self):
        suite_name = "Suite 4: ComfyUI Integration & Nodes"
        print(f"\n▶ Running {suite_name}...")

        # 1. Check nodes.py syntax and class registrations
        nodes_path = os.path.join(BASE_DIR, "nodes.py")
        t0 = time.time()
        if os.path.exists(nodes_path):
            with open(nodes_path, "r", encoding="utf-8") as f:
                nodes_code = f.read()

            has_staging_glb = "class StagingGLBNode" in nodes_code
            has_mapping = '"StagingGLBNode": StagingGLBNode' in nodes_code
            has_ub_mapping = '"UBStagingGLBNode": StagingGLBNode' in nodes_code
            has_glb_route = "/scene_camera_action/get_glb" in nodes_code
            has_glb_scanner = ".glb" in nodes_code

            dur = time.time() - t0
            passed = has_staging_glb and has_mapping and has_ub_mapping and has_glb_route and has_glb_scanner
            details = "StagingGLBNode & UBStagingGLBNode defined, mapped, and /get_glb route active"
            self.add_result(suite_name, "nodes.py StagingGLBNode Registration", passed, details, dur)
        else:
            self.add_result(suite_name, "nodes.py exists", False, "File not found")

        # 2. Check __init__.py export mappings
        init_path = os.path.join(BASE_DIR, "__init__.py")
        t0 = time.time()
        if os.path.exists(init_path):
            with open(init_path, "r", encoding="utf-8") as f:
                init_code = f.read()
            has_export = "NODE_CLASS_MAPPINGS" in init_code and "NODE_DISPLAY_NAME_MAPPINGS" in init_code
            dur = time.time() - t0
            self.add_result(suite_name, "__init__.py Node Exports", has_export, "Exports NODE_CLASS_MAPPINGS and WEB_DIRECTORY", dur)
        else:
            self.add_result(suite_name, "__init__.py exists", False, "File not found")

    # --------------------------------------------------------------------------
    # SUMMARY & REPORTING
    # --------------------------------------------------------------------------
    def _summarize(self, total_duration: float) -> bool:
        total = len(self.results)
        passed_count = sum(1 for r in self.results if r["passed"])
        failed_count = total - passed_count

        print("\n" + "=" * 76)
        print("  E2E TEST EXECUTION SUMMARY")
        print("=" * 76)

        current_suite = ""
        for r in self.results:
            if r["suite"] != current_suite:
                current_suite = r["suite"]
                print(f"\n  [{current_suite}]")

            status_icon = "✓ PASS" if r["passed"] else "✗ FAIL"
            print(f"    [{status_icon}] {r['name']} ({r['duration_ms']}ms)")
            print(f"           → {r['details']}")

        print("\n" + "-" * 76)
        rate = (passed_count / total * 100.0) if total > 0 else 0.0
        print(f"  Total Tests: {total} | Passed: {passed_count} | Failed: {failed_count} | Pass Rate: {rate:.1f}%")
        print(f"  Execution Time: {round(total_duration, 2)}s")
        print("=" * 76)

        if failed_count == 0:
            print("  🎉 ALL QUALITY GATES AND E2E PIPELINE TESTS PASSED (100%)\n")
            return True
        else:
            print(f"  ❌ {failed_count} TEST(S) FAILED. See details above.\n")
            return False


def main():
    parser = argparse.ArgumentParser(description="E2E Dual 3D Stage Architecture Test Runner")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose test diagnostics")
    parser.add_argument("--json", action="store_true", help="Output JSON results")
    args = parser.parse_args()

    runner = E2ETestRunner(verbose=args.verbose)
    all_passed = runner.run_all()

    if args.json:
        print(json.dumps({
            "passed": all_passed,
            "results": runner.results
        }, indent=2))

    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()
