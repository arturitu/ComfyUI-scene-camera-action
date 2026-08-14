---
name: stage-builder
description: Turn any natural language description or reference image into a structured 3D staging environment (graybox/blockout composition) strictly using transformed 3D Box primitives for ComfyUI-scene-camera-action. Features Pre-Spec spatial reasoning, 4-layer stage decomposition, actor-clearance contracts, deterministic validation gates, and iterative JSON modification.
license: Apache-2.0
version: 2.0.0
---

# stage-builder — 3D Stage & Staging AI Skill

Convert any text prompt, natural language request, or reference image into a clean, proportioned 3D staging environment built **strictly using transformed 3D Box primitives** (`type: 'block'` and `type: 'group'`) for the **ComfyUI-scene-camera-action** (`StagingNode`) ecosystem.

---

## 1. Core Rule: 100% Box Primitive Constraint

Every object, wall, roof, prop, vehicle part, tree, animal limb, staircase, or furniture piece in the generated stage **MUST be constructed using 3D Box primitives** (`type: 'block'`).
- Do **NOT** reference external `.gltf` / `.obj` meshes or non-box geometries.
- Use spatial scaling (`sx, sy, sz`), rotation (`rx, ry, rz` in radians), translation (`px, py, pz`), and hierarchical grouping (`type: 'group'`) to assemble any form (slopes, columns, arches, steps, roofs, vehicles, characters, trees).

---

## 2. 3D Coordinate System, Ground Alignment & World Bounds

### Axes & Units
- **Scale**: 1 unit = 1.0 meter.
- $X$: Screen-Left (-) to Screen-Right (+)
- $Y$: Vertical height. Ground level is at $Y = 0.0$
- $Z$: Background / North (-) to Foreground / South (+)

### Camera-to-World Orientation & Anti-Mirroring Rule
When mapping from reference images or default isometric/frontal views (camera facing from $+Z$ towards $-Z$):
- **Viewer / Screen-LEFT is ALWAYS Negative X ($P_x < 0$)**.
- **Viewer / Screen-RIGHT is ALWAYS Positive X ($P_x > 0$)**.
- **Viewer / FOREGROUND (closer to camera) is ALWAYS Positive Z ($P_z > 0$)**.
- **Viewer / BACKGROUND (farther from camera) is ALWAYS Negative Z ($P_z < 0$)**.
- **Anti-Mirroring Warning (Egocentric Bias)**: When looking at a front-facing building (like a courthouse, house, or character), NEVER use the subject's internal left/right! Always use the **Viewer's Screen Axes**: what appears on the left half of the reference image MUST be placed at $P_x < 0$, and what appears on the right half MUST be placed at $P_x > 0$.

### Built-in Floor — DO NOT Generate
The 3D viewport contains a built-in floor plane and infinite grid at $Y = 0$. **Do NOT add any floor, ground plane, terrain base plate, or ground slab block** at $Y=0$.

### Ground Alignment Rule ($P_y = S_y / 2.0$)
- Box position $(P_x, P_y, P_z)$ defines the **geometric center** of the box.
- Any block resting directly on the ground ($Y=0$) with height $S_y$ **MUST** have $P_y = S_y / 2.0$.
  - Example: A wall of height 4.0m resting on the ground has $P_y = 2.0$.
  - Example: A road segment of thickness 0.2m resting on the ground has $P_y = 0.1$.
- **Critical**: Never place ground-resting objects at $P_y = 0$.

### World Bounds
- The usable stage area is **100 × 100 meters** centered at the origin, spanning from $(-50, 0, -50)$ to $(50, Y_{max}, 50)$.
- Typical staging sizes:
  - **Interior / Room**: 10×10m to 20×20m
  - **Street Block / Intersection**: 30×30m to 50×50m
  - **Large Landscape / Track**: 60×60m to 90×90m

---

## 3. Pre-Spec Spatial Reasoning (StageSpec Contract)

Before generating the raw JSON blocks, formulate a mental or structured **StageSpec blueprint**:

1. **Active World Bounds**: Determine bounding box extents $(X_{min}, X_{max}, Z_{min}, Z_{max})$.
2. **Functional Zoning**: Partition the area into functional corridors (e.g. main roadway, sidewalk, building footprint, open plaza, obstacle zone).
3. **Actor-Aware Clearance Contracts**:
   - **Car Corridor (`actor_type: 'car'`)**: Road lanes minimum width $\ge 4.0\text{m}$ (`sx = 4.0`), ramp pitch between $10^\circ$ and $25^\circ$ ($0.17$ to $0.43$ rad), overpass/bridge vertical clearance $P_y \ge 3.5\text{m}$.
   - **Human Corridor (`actor_type: 'human'`)**: Doorways $\ge 1.2\text{m}$ wide $\times 2.2\text{m}$ high, stair steps $\approx 0.25\text{m}$ height $\times 0.4\text{m}$ depth.
4. **Anchor & Attachment Hierarchy**: Ensure secondary forms (tabletops, roof tops, foliage) declare exact relative heights ($Y_{top} = P_y + S_y / 2.0$) so parts never float disconnected in mid-air.

---

## 4. 4-Pass Staged Sculpting Pipeline

Assemble stages systematically in 4 progressive passes:

```
Pass 1: Base & Bounds ───► Pass 2: Structures & Corridors ───► Pass 3: Secondary Props ───► Pass 4: Accents & QA Gates
```

### Pass 1: Environment Base & Foundation Platforms (NO ground plane)
- Elevated platforms, curbs, foundation pads, road tracks, terrain steps.
- Establishes navigable topography and floor level variations.

### Pass 2: Main Structural Volumes & Navigable Corridors
- Primary architectural walls, building bodies, bridge spans, large slopes.
- Defines silhouettes, sightlines, and maintains actor clearance corridors.

### Pass 3: Secondary Forms & Compound Props (Grouped)
- Roofs, pillars, doors, windows, tables, chairs, tree trunks + foliage crowns, vehicles, fences.
- Encapsulate compound objects into logical `group` nodes (e.g. `House`, `Tree_01`, `Bridge_Arch`, `Dining_Table`).

### Pass 4: Accent Details & Quality Assurance Gates
- Chimneys, railings, trim lines, obstacles, barriers, small props.
- Run deterministic validation via `staging_utils.py` to guarantee zero bounds violations, zero floating roots, and exact block counting.

---

## 5. StageState Schema Specification

Stages consumed by `StagingNode` (`UBStagingNode`) adhere to the clean `StageState` JSON schema:

```json
{
  "type": "cube_stage",
  "num_assets": 5,
  "nodes": [
    {
      "id": "group_house_01",
      "type": "group",
      "name": "House",
      "transform": {
        "px": 0.0, "py": 0.0, "pz": 0.0,
        "rx": 0.0, "ry": 0.0, "rz": 0.0,
        "sx": 1.0, "sy": 1.0, "sz": 1.0
      },
      "children": [
        {
          "id": "wall_main",
          "type": "block",
          "name": "Main Wall",
          "transform": {
            "px": 0.0, "py": 1.5, "pz": 0.0,
            "rx": 0.0, "ry": 0.0, "rz": 0.0,
            "sx": 4.0, "sy": 3.0, "sz": 4.0
          }
        },
        {
          "id": "roof_top",
          "type": "block",
          "name": "Roof",
          "transform": {
            "px": 0.0, "py": 3.5, "pz": 0.0,
            "rx": 0.0, "ry": 0.785, "rz": 0.0,
            "sx": 3.2, "sy": 1.0, "sz": 3.2
          }
        }
      ]
    }
  ]
}
```

*(Note: Actor spawn points and kinematics belong to `ActingState` / `ActorRecord` and are not stored in `StageState`).*

---

## 6. Procedural Tooling & CLI Reference (`scripts/staging_utils.py`)

A comprehensive Python helper suite is provided in [`scripts/staging_utils.py`](file:///Users/unboring/Documents/antigravity/ComfyUI-scene-camera-action/skills/stage-builder/scripts/staging_utils.py):

### Available Procedural Generators:
- `create_block_node(name, px, py, pz, sx, sy, sz, rx, ry, rz)`
- `create_group_node(name, children, px, py, pz, rx, ry, rz, sx, sy, sz)`
- `generate_curved_track_blocks(start_pos, radius, angle_degrees, segments, road_width)`
- `generate_staircase_blocks(start_pos, num_steps, step_width, step_height, step_depth, heading_rad)`
- `generate_ramp_blocks(start_pos, length, height, width, thickness, heading_rad)`
- `generate_arch_blocks(center_pos, opening_width, opening_height, pillar_width, arch_depth)`
- `generate_tree_group(pos, trunk_height, trunk_radius, foliage_layers, name)`
- `generate_building_group(pos, width, depth, height, roof_style, name)`
- `generate_fence_segment(start_pos, length, height, num_posts, heading_rad, name)`

### Deterministic Quality Gates & Transformations:
- `validate_stage_state(stage_data)`: Validates schema, cleans invalid structures, and updates `num_assets`.
- `check_ground_alignment(stage_data)`: Detects root blocks not resting at $P_y = S_y / 2.0$.
- `fix_ground_alignment(stage_data)`: Auto-corrects near-ground root blocks to $P_y = S_y / 2.0$.
- `flip_stage_axis(stage_data, axis='x')`: Mirrors entire stage across X or Z axis.
- `check_world_bounds(stage_data)`: Detects any geometries outside $\pm 50\text{m}$.
- `inspect_stage(stage_data)`: Generates an ASCII tree report of all groups, blocks, and quality gates.

### CLI Usage:
```bash
# Inspect and report on a stage JSON
python skills/stage-builder/scripts/staging_utils.py presets/gas_station.json --inspect

# Mirror a stage horizontally across X axis (fixes inverted left/right)
python skills/stage-builder/scripts/staging_utils.py my_stage.json --flip-x -o my_stage.json

# Validate and clean a stage JSON
python skills/stage-builder/scripts/staging_utils.py my_stage.json --validate -o my_stage.json

# Auto-fix ground alignment on misaligned root blocks
python skills/stage-builder/scripts/staging_utils.py my_stage.json --fix-ground -o my_stage.json

# Generate a demo procedural stage
python skills/stage-builder/scripts/staging_utils.py --demo -o presets/procedural_demo.json
```

---

## 7. File Naming & Preset Storage

- Preset filenames **MUST be in English**, lowercase with underscores:
  - `urban_intersection.json`, `sci_fi_hangar.json`, `mountain_pass.json`, `cozy_bedroom.json`
- Custom node presets reside in `presets/` or ComfyUI's `input/staging_stages/`.

---

## 8. Iterative Editing & Modification Protocol

When modifying an existing stage (e.g. *"make the building taller"*, *"add a curved ramp to the left"*, *"add trees along the road"*):

1. **Inspect Existing Stage**: Parse and read the current `StageState` JSON.
2. **Target Node Identification**: Locate target node by `id` or `name`.
3. **Apply Delta Modifications**:
   - **Transforms**: Update `px, py, pz`, `rx, ry, rz`, or `sx, sy, sz`.
   - **Additions**: Use procedural generator helpers or create new `block`/`group` nodes and append.
   - **Deletions**: Remove specified nodes from children lists.
4. **Run Quality Validation Gate**:
   - Execute `validate_stage_state()` to recalculate `num_assets`.
   - Verify ground alignment ($P_y = S_y / 2.0$) and world bounds ($[-50, 50]$).
5. **Output Valid JSON**: Return the clean, complete `StageState` JSON.
