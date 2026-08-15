---
name: stage-builder
description: Turn any natural language description or reference image into a structured 3D staging environment (graybox/blockout composition) strictly using transformed 3D Box primitives for ComfyUI-scene-camera-action. Features Pre-Spec spatial reasoning, 4-layer stage decomposition, actor-clearance contracts, 5 universal pure geometric generators, deterministic validation gates, and iterative JSON modification.
license: Apache-2.0
version: 3.0.0
---

# stage-builder — 3D Stage & Staging AI Skill

Convert any text prompt, natural language request, or reference image into a clean, proportioned 3D staging environment built **strictly using transformed 3D Box primitives** (`type: 'block'` and `type: 'group'`) for the **ComfyUI-scene-camera-action** (`StagingNode`) ecosystem.

---

## 1. Core Rule: 100% Box Primitive Constraint

Every object, wall, roof, prop, vehicle part, tree, animal limb, staircase, or furniture piece in the generated stage **MUST be constructed using 3D Box primitives** (`type: 'block'`).
- Do **NOT** reference external `.gltf` / `.obj` meshes or non-box geometries.
- Use spatial scaling (`sx, sy, sz`), rotation (`rx, ry, rz` in radians), translation (`px, py, pz`), and hierarchical grouping (`type: 'group'`) to assemble any form (slopes, columns, arches, steps, roofs, vehicles, characters, trees).

---

## 2. Core Immutability Rule (Strictly Domain-Agnostic Core)

[`scripts/staging_utils.py`](file:///Users/unboring/Documents/antigravity/ComfyUI-scene-camera-action/skills/stage-builder/scripts/staging_utils.py) is a **pure mathematical and deterministic validation engine**.
- **PROHIBITION**: The AI **MUST NEVER** add ad-hoc, domain-specific, or thematic helper functions (such as specific park benches, gas pumps, cinema marquees, or particular house templates) to `staging_utils.py`.
- **COMPOSITION**: Any arbitrary thematic object requested by the user must be composed directly in the stage builder script or stage JSON by combining the **5 Universal Pure Geometric Generators** and primitive box transformations.

---

## 3. 3D Coordinate System, Ground Alignment & World Bounds

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

### Three.js Euler Rotation & Cardinal Angle Sign Rules
Three.js uses a **Right-Handed Coordinate System** with intrinsic Euler order `'XYZ'` in radians:

#### 1. Linear Segments & Walkways Heading Angle ($R_y$)
When connecting 2D point $P_1(x_1, z_1)$ to $P_2(x_2, z_2)$:
$$\Delta x = x_2 - x_1, \quad \Delta z = z_2 - z_1, \quad R_y = \text{atan2}(\Delta x, \Delta z)$$
- Example: Connecting Center $(0,0)$ to South-West $(-11, 11) \rightarrow R_y = \text{atan2}(-11, 11) = -45^\circ = -0.785\text{ rad}$.
- Example: Connecting Center $(0,0)$ to South-East $(11, 11) \rightarrow R_y = \text{atan2}(11, 11) = +45^\circ = +0.785\text{ rad}$.
- Always use `create_segment_between(name, p1, p2, width, height, y_center)` to eliminate manual trigonometric errors.

#### 2. Pitch ($R_x$) — Rotation Around X-Axis (Tilt Forward/Back)
- **Awnings on North-facing wall (facing South $+Z$)**: Sloping down to street $\rightarrow$ **$R_x > 0$** ($+0.25\text{ rad}$).
- **Awnings on South-facing wall (facing North $-Z$)**: Sloping down to street $\rightarrow$ **$R_x < 0$** ($-0.25\text{ rad}$).
- **Ramps ascending along $+Z$**: **$R_x < 0$**; **Ramps descending along $+Z$**: **$R_x > 0$**.

#### 3. Yaw ($R_y$) — Rotation Around Y-Axis (Compass Pan / Heading)
Looking from top $+Y$ down to ground (Bird's-Eye View): Positive $R_y$ is **Counter-Clockwise (CCW)**.
- **Wedge / V-Shaped Marquees (Pointing OUTWARD to the street as a prow)**:
  - **On East Facade (facing West $-X$)**:
    - North wing ($Z < Z_{apex}$): **$R_y < 0$** (angles back to wall at $+X$).
    - South wing ($Z > Z_{apex}$): **$R_y > 0$** (angles back to wall at $+X$).
  - **On West Facade (facing East $+X$)**:
    - North wing ($Z < Z_{apex}$): **$R_y > 0$**; South wing ($Z > Z_{apex}$): **$R_y < 0$**.

#### 4. Roll ($R_z$) — Rotation Around Z-Axis (Gable Roofs & Pediments)
Looking at a front-facing building (facing North $-Z$):
- **Gable Roofs ($\wedge$ Peak, NOT $\vee$ Trough)**:
  - **Left Roof Slope ($X < 0$)**: Rising towards center apex $X=0 \rightarrow$ **$R_z > 0$** (e.g. $+0.42\text{ rad}$).
  - **Right Roof Slope ($X > 0$)**: Falling from center apex $X=0 \rightarrow$ **$R_z < 0$** (e.g. $-0.42\text{ rad}$).
  - **Left Pediment Cornice ($X < 0$)**: **$R_z > 0$** ($+0.44\text{ rad}$); **Right Pediment Cornice ($X > 0$)**: **$R_z < 0$** ($-0.44\text{ rad}$).

#### 5. Street Curb Alignment & Sidewalk Elevation
- **Asphalt / Roadways**: Rest directly on the viewport 3D grid at $Y = 0$. Do NOT generate large ground slabs at $Y=0$.
- **Sidewalks & Curbs**: Elevated slightly at cota $Y = 0.1\text{m}$ ($S_y = 0.2\text{m}, P_y = 0.1\text{m}$).
- **Parked Vehicles**: Placed flush against the storefront sidewalk curb: $P_{x,car} = P_{x,storefront} \pm (\text{Sidewalk Width}) \pm (S_{x,car}/2)$.

---

## 4. The 5 Universal Pure Geometric Generators

Provided by [`scripts/staging_utils.py`](file:///Users/unboring/Documents/antigravity/ComfyUI-scene-camera-action/skills/stage-builder/scripts/staging_utils.py):

| Generator | Purpose | Use Cases |
| :--- | :--- | :--- |
| `create_segment_between(name, p1, p2, width, height, y_center)` | Vector connecting $(x_1, z_1)$ to $(x_2, z_2)$ with automated length & heading | Diagonals, angled walls, beams, tracks, pipes, linear curbs |
| `generate_linear_array(name_prefix, start_pos, count, step_vector, block_size, rotation)` | Array of $N$ identical blocks distributed along a 3D step vector | Pillars, columns, fence posts, street curbs, barriers, sleepers |
| `generate_radial_arc(name_prefix, center_pos, radius, start_deg, end_deg, segments, ...)` | Circular arcs, curved tracks, and full rings | Curved roads, circular towers, colosseums, semicircular plazas, arenas |
| `generate_stepped_incline(name_prefix, start_pos, num_steps, step_width, step_height, step_depth, heading_rad)` | Staircases, tiered seating, and terraced slopes | Stairs, colosseum seating, stepped terraces, pyramid bases |
| `generate_sloped_ramp(name, start_pos, length, height, width, thickness, heading_rad)` | Angled planar incline with automated pitch ($R_x$) and heading ($R_y$) | Vehicle ramps, angled roofs, slides, conveyor inclines, jump pads |

---

## 5. Pre-Spec Spatial Reasoning (StageSpec Contract)

Before generating raw JSON blocks, formulate a mental or structured **StageSpec blueprint**:

1. **Active World Bounds**: Determine bounding box extents $(X_{min}, X_{max}, Z_{min}, Z_{max})$.
2. **Functional Zoning**: Partition the area into functional corridors (e.g. main roadway, sidewalk, building footprint, open plaza, obstacle zone).
3. **Actor-Aware Clearance Contracts**:
   - **Car Corridor (`actor_type: 'car'`)**: Road lanes minimum width $\ge 4.0\text{m}$ (`sx = 4.0`), ramp pitch between $10^\circ$ and $25^\circ$ ($0.17$ to $0.43$ rad), overpass/bridge vertical clearance $P_y \ge 3.5\text{m}$.
   - **Human Corridor (`actor_type: 'human'`)**: Doorways $\ge 1.2\text{m}$ wide $\times 2.2\text{m}$ high, stair steps $\approx 0.2\text{m}$ height $\times 0.4\text{m}$ depth.
4. **Anchor & Attachment Hierarchy**: Ensure secondary forms (tabletops, roof tops, foliage) declare exact relative heights ($Y_{top} = P_y + S_y / 2.0$) so parts never float disconnected in mid-air.

---

## 6. StageState Schema Specification

Stages consumed by `StagingNode` (`UBStagingNode`) adhere to the clean `StageState` JSON schema:

```json
{
  "type": "cube_stage",
  "num_assets": 5,
  "nodes": [
    {
      "id": "group_building_01",
      "type": "group",
      "name": "Building",
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

## 7. Deterministic Quality Gates & CLI Reference

Run deterministic validation via [`scripts/staging_utils.py`](file:///Users/unboring/Documents/antigravity/ComfyUI-scene-camera-action/skills/stage-builder/scripts/staging_utils.py):

```bash
# Inspect and generate ASCII report on stage hierarchy and quality gates
python skills/stage-builder/scripts/staging_utils.py presets/courthouse_square.json --inspect

# Mirror a stage horizontally across X axis (fixes inverted left/right)
python skills/stage-builder/scripts/staging_utils.py my_stage.json --flip-x -o my_stage.json

# Validate and clean a stage JSON
python skills/stage-builder/scripts/staging_utils.py my_stage.json --validate -o my_stage.json

# Auto-fix ground alignment on misaligned root blocks
python skills/stage-builder/scripts/staging_utils.py my_stage.json --fix-ground -o my_stage.json
```

---

## 8. File Naming & Preset Storage

- Preset filenames **MUST be in English**, lowercase with underscores:
  - `courthouse_square.json`, `brutalism_face.json`, `gas_station.json`, `collapsed_warehouse.json`
- Presets reside in `presets/` or ComfyUI's `input/staging_stages/`.
