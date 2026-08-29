---
name: stage-builder
description: Turn any natural language description or reference image into a structured 3D staging environment (graybox/blockout composition) strictly using transformed 3D Box primitives for ComfyUI-scene-camera-action. Features Step 0 interactive spatial deconstruction, structured user clarification questionnaire, Pre-Spec spatial reasoning, 4-layer stage decomposition, actor-clearance contracts, 5 universal pure geometric generators, deterministic validation gates, and iterative JSON modification.
license: Apache-2.0
version: 3.1.0
---

# stage-builder — 3D Stage & Staging AI Skill (v3.1.0)

Convert any text prompt, natural language request, or reference image into a clean, proportioned 3D staging environment built **strictly using transformed 3D Box primitives** (`type: 'block'` and `type: 'group'`) for the **ComfyUI-scene-camera-action** (`StagingNode`) ecosystem.

---

## 0. Step 0: Spatial Deconstruction & User Interaction (Mandatory Protocol)

Before generating or modifying any 3D geometry or JSON file, the agent **MUST** execute **Step 0**. This step guarantees millimeter-accurate alignment with user intent, prevents geometric hallucinations, and eliminates spatial mirroring errors.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   WORKFLOW v3.1.0                                      │
│                                                                                        │
│  [Reference / Prompt]                                                                  │
│           │                                                                            │
│           ▼                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │ PHASE 0.1 — Analytical Spatial Fact Extraction (3 to 6 Decisive Facts)           │  │
│  │ (No intermediate diffusion images: straight to spatial facts)                    │  │
│  └──────────────────────────────────────────────────────────────────────────────────┘  │
│           │                                                                            │
│           ▼                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │ PHASE 0.2 — Structured User Questionnaire Protocol                               │  │
│  │ (Standardized multiple-choice questionnaire: scale, clearance, hero landmarks)   │  │
│  └──────────────────────────────────────────────────────────────────────────────────┘  │
│           │                                                                            │
│           ▼ [User Confirmation]                                                        │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │ PHASE 1 — JSON Geometry Generation (100% Box Primitives + 5 Pure Generators)     │  │
│  └──────────────────────────────────────────────────────────────────────────────────┘  │
│           │                                                                            │
│           ▼                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │ PHASE 2 — CLI Quality Gate (staging_utils.py --inspect / --validate)             │  │
│  └──────────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Phase 0.0 — Stage Architecture Selection Gate (Blockout JSON vs. Blender Clay GLB)

If the user's initial request does not explicitly specify whether they want a **Blockout Stage (JSON)** or a **Clay 3D Stage (Blender GLB)**, the agent **MUST FIRST ASK** the user to choose their preferred architecture:

1. **Option A: Blockout Stage (JSON `cube_stage`)** *(via `stage-builder`)*:
   - Built exclusively from transformed 3D box primitives and geometric arrays.
   - Lightweight, directly editable in the ComfyUI `StagingNode` visual viewport.
   - Ideal for rapid blocking, parametric layout planning, and clean geometric structures.
2. **Option B: Stylized Clay Stage (Blender `.glb` + `.blend`)** *(via `stage-blender-builder`)*:
   - Built in Blender with arbitrary geometries (curves, cylinders, arches, bevels, booleans, organic props).
   - Unified matte clay material (`#c9c9cf`) with smooth ground collisions and camera cutout dithering.
   - Exports a production `.glb` for ComfyUI and saves the native `.blend` project locally for user inspection.

---

### Phase 0.1 — Analytical Extraction of Decisive Spatial Facts

From the user's reference image or description, the agent must analytically extract **3 to 6 decisive spatial facts** following the logic of *"Deconstruction — Selection — Refinement — Reconstruction"*:

> ⚠️ **Zero Intermediate Diffusion Principle**: The agent **MUST NEVER** generate intermediate diffusion images (such as img2img passes, depth-to-image, or neural sketches) to interpret the scene. Spatial extraction must be purely analytical and symbolic to prevent stochastic artifacts, spurious curved lines, and hallucinated parasitic elements.

| # | Decisive Spatial Fact | Analytical Parameters | Geometric Verification Rule |
| :-: | :--- | :--- | :--- |
| **1** | **Hero Landmark Massing** | Identification of the primary focal mass, approximate dimensions $(S_x, S_y, S_z)$, visual center of gravity, and volumetric hierarchy. | Establishes the primary metric reference for all other elements. |
| **2** | **Metric World Bounds** | Active bounded footprint $[X_{min}, X_{max}] \times [Z_{min}, Z_{max}] \times [Y_{min}, Y_{max}]$. Real-world scale in meters ($1\text{ unit} = 1.0\text{m}$). | The entire stage must be strictly contained within $[-50.0, +50.0]\text{m}$. Ground base level is $Y = 0.0$. |
| **3** | **Circulation & Clearance Contract** | Area partitioning: vehicular roadways, pedestrian sidewalks, building footprint, open plazas, and obstacle zones. | Vehicular roadway lane width $\ge 4.0\text{m}$; sidewalks elevated at $Y = 0.1\text{m}$; vertical clearance $\ge 3.5\text{m}$ for vehicles and $\ge 2.2\text{m}$ for pedestrians. |
| **4** | **Orientation Axes & Anti-Mirroring Rule** (*Viewer Screen Axes*) | Facade orientations ($R_y$), primary entrances, and camera line of sight. | **Screen-Left = $X < 0$**, **Screen-Right = $X > 0$**, **Foreground = $+Z$**, **Background = $-Z$**. Never use the internal egocentric perspective of the subject/building. |
| **5** | **Relative Proportions, Anchors & Offsets** | Height ratios of secondary volumes (turrets, marquees, porches) relative to the main hull. Top surface anchor heights ($Y_{top} = P_y + S_y/2$). | Superimposed elements on facades must include a normal surface offset $\ge 0.05\text{m}$ to prevent Z-fighting. |
| **6** | **Deliberate Voids & Corridors** | Intentional clear zones for camera trajectories (`DirectingNode`) and actor maneuverability (`ActingNode`). | Reserve a minimum clear corridor of $10\text{m} \times 10\text{m}$ in the primary action area. |

---

### Phase 0.2 — Structured User Questionnaire Protocol

Once spatial facts are extracted, the agent **MUST** present the analytical summary to the user and ask the following standardized multiple-choice questionnaire to confirm configuration before generating geometry:

```markdown
### 📋 Step 0: Spatial Deconstruction & Stage Confirmation

I have analyzed your reference and extracted the following **Decisive Spatial Facts**:
- **Hero Landmark**: [e.g., 3-story Neoclassical institutional building, 24m wide x 12m high]
- **Active Footprint**: [e.g., 50m x 50m (X ∈ [-25, 25], Z ∈ [-25, 25])]
- **Zoning**: [e.g., Two-lane vehicular road at Z ∈ [8, 16], sidewalks at Y=0.1m, central plaza]
- **Orientation Axes**: [e.g., Main facade facing South (+Z), symmetry at X=0]
- **Critical Proportions**: [e.g., Clock tower at 2.2x height of main cornice, portico protruding 3m]
- **Negative Space**: [e.g., Clear 15m front corridor for camera tracking and actor movement]

Please confirm the following key options before generating the 3D geometry:

**1. Stage Scale & Footprint:**
- [A] **Standard / Urban City Block** (~40m - 60m): Ideal for vehicles and mixed circulation.
- [B] **Compact / Focal Set** (~15m - 25m): Focused on a single building or specific diorama.
- [C] **Expanded / Landscape** (~80m - 100m): Large-scale open environment.

**2. Primary Actor Type & Clearance Contract:**
- [A] **Vehicles / Cars** (lanes ≥ 4.0m, ramps 10°-20°, vertical clearance ≥ 3.5m).
- [B] **Pedestrians / Humans** (elevated sidewalks Y=0.1m, doors 1.2m x 2.2m, stairs 0.2m x 0.4m).
- [C] **Pure Architectural Diorama** (no traffic clearance constraints).

**3. Landmark Hierarchy & Stylization:**
- [A] **Realistic / Architectural Proportions** (faithful 1:1 metric scale).
- [B] **Monumental / Exaggerated Hero Element** (tower/primary landmark accentuated with extra height).
- [C] **Minimalist / Schematic Blockout** (clean simplified primitive volumes).
```

### 🛑 MANDATORY EXECUTION BARRIER — DO NOT PROCEED IN THE SAME TURN

> [!CAUTION]
> **CRITICAL AGENT DIRECTIVE: HARD STOP**
> When the user requests creating or editing a stage (or uploads a reference image):
> 1. You **MUST** present Phase 0.0 (Stage Architecture Selection: Option A Blockout JSON vs. Option B Blender Clay GLB) AND Phase 0.1/Phase 0.2 (Decisive Spatial Facts & 3-Question Questionnaire).
> 2. **YOU MUST STOP CALLING TOOLS IMMEDIATELY.**
> 3. **DO NOT generate any JSON geometry, DO NOT write files, and DO NOT call generation tools in this turn.**
> 4. **END YOUR TURN** and wait for the user's explicit reply. You may only proceed to Phase 1 (Geometry Generation) in the subsequent turn after the user has responded.

---

## 1. Core Rule: 100% Box Primitive Constraint

Every object, wall, roof, prop, vehicle, tree, character limb, staircase, or piece of furniture in the generated stage **MUST be constructed exclusively using 3D Box primitives** (`type: 'block'`) and hierarchical groups (`type: 'group'`).
- **PROHIBITED**: Referencing external `.gltf` / `.obj` files or non-box geometries within the JSON workflow.
- **COMPOSITION**: Use translations (`px, py, pz`), rotations (`rx, ry, rz` in radians), scales (`sx, sy, sz` in meters), and hierarchies (`children`) to model any volumetric structure.

---

## 2. Mathematical Core Immutability Rule (`staging_utils.py`)

[`scripts/staging_utils.py`](scripts/staging_utils.py) is a **pure mathematical engine and deterministic validator**.
- **STRICT PROHIBITION**: The agent **MUST NEVER** add ad-hoc, domain-specific, or thematic helper functions (such as park benches, gas pumps, specific marquees, or prefabricated house templates) inside `staging_utils.py`.
- **PURE COMPOSITION**: Any required thematic structure must be composed directly in the stage builder script or final JSON by combining the **5 Universal Pure Geometric Generators** and box transformations.

---

## 3. 3D Coordinate System, Ground Alignment & World Bounds

### Axes & Units
- **Scale**: 1 unit = 1.0 meter.
- $X$: Screen-Left (-) to Screen-Right (+)
- $Y$: Vertical height. Ground base level is at $Y = 0.0$
- $Z$: Background / North (-) to Foreground / South (+)

### Camera-to-World Orientation & Anti-Mirroring Rule (Viewer Screen Axes)
When interpreting reference images or standard isometric/frontal views (camera facing from $+Z$ towards $-Z$):
- **Viewer / Screen-LEFT is ALWAYS Negative X ($P_x < 0$)**.
- **Viewer / Screen-RIGHT is ALWAYS Positive X ($P_x > 0$)**.
- **Viewer / FOREGROUND (closer to camera) is ALWAYS Positive Z ($P_z > 0$)**.
- **Viewer / BACKGROUND (farther from camera) is ALWAYS Negative Z ($P_z < 0$)**.
- **Ground Alignment Rule ($Y=0$)**: Any block resting directly on the ground must satisfy $P_y = S_y / 2.0$.

### Euler Rotation Sign Rules in Three.js ('XYZ' in Radians)

#### 1. Linear Segments & Heading Angle ($R_y$)
When connecting point $P_1(x_1, z_1)$ to $P_2(x_2, z_2)$:
$$\Delta x = x_2 - x_1, \quad \Delta z = z_2 - z_1, \quad R_y = \text{atan2}(\Delta x, \Delta z)$$
- Always use `create_segment_between(name, p1, p2, width, height, y_center)` to automatically compute length, midpoint position, and heading angle.

#### 2. Pitch ($R_x$) — Rotation Around X-Axis (Tilt Forward/Back)
- **Awnings on North-facing wall (facing South $+Z$)**: Sloping down toward the street $\rightarrow$ **$R_x > 0$** ($+0.25\text{ rad}$).
- **Awnings on South-facing wall (facing North $-Z$)**: Sloping down toward the street $\rightarrow$ **$R_x < 0$** ($-0.25\text{ rad}$).
- **Ramps ascending along $+Z$**: **$R_x < 0$**; **Ramps descending along $+Z$**: **$R_x > 0$**.

#### 3. Yaw ($R_y$) — Rotation Around Y-Axis (Horizontal Pan)
Bird's-eye view looking down from $+Y$ toward the ground: Positive $R_y$ rotates **Counter-Clockwise (CCW)**.

#### 4. Roll ($R_z$) — Rotation Around Z-Axis (Gable Roofs & Pediments)
Facing a front-facing building (facing North $-Z$):
- **Left Roof Slope ($X < 0$)**: Rising towards center ridge $X=0 \rightarrow$ **$R_z > 0$** (e.g. $+0.42\text{ rad}$).
- **Right Roof Slope ($X > 0$)**: Falling from center ridge $X=0 \rightarrow$ **$R_z < 0$** (e.g. $-0.42\text{ rad}$).

#### 5. Sidewalks, Curbs & Roadways
- **Roadways / Asphalt**: Rest directly on the viewport grid at $Y = 0$. Do NOT generate massive ground slab blocks at $Y=0$.
- **Sidewalks & Curbs**: Elevated at height $Y = 0.1\text{m}$ ($S_y = 0.2\text{m}, P_y = 0.1\text{m}$).
- **Parked Vehicles**: Positioned flush against the sidewalk curb: $P_{x,car} = P_{x,sidewalk} \pm (\text{Sidewalk Width}) \pm (S_{x,car}/2)$.

---

## 4. The 5 Universal Pure Geometric Generators

Provided by [`scripts/staging_utils.py`](scripts/staging_utils.py):

| Generator | Purpose | Use Cases |
| :--- | :--- | :--- |
| `create_segment_between(name, p1, p2, width, height, y_center)` | Vector connecting $(x_1, z_1)$ to $(x_2, z_2)$ with automated length & heading | Diagonals, angled walls, beams, pipes, linear curbs |
| `generate_linear_array(name_prefix, start_pos, count, step_vector, block_size, rotation)` | Array of $N$ identical blocks distributed along a 3D step vector | Pillars, columns, fence posts, street curbs, barriers, sleepers |
| `generate_radial_arc(name_prefix, center_pos, radius, start_deg, end_deg, segments, ...)` | Circular arcs, curved paths, and full rings | Curved roads, circular towers, colosseums, semicircular plazas |
| `generate_stepped_incline(name_prefix, start_pos, num_steps, step_width, step_height, step_depth, heading_rad)` | Staircases, tiered seating, and terraced slopes | Bleachers, entrance stairs, stepped terraces, pyramid bases |
| `generate_sloped_ramp(name, start_pos, length, height, width, thickness, heading_rad)` | Angled planar incline with automated pitch ($R_x$) and heading ($R_y$) | Vehicle ramps, angled roofs, slides, conveyor inclines, jump pads |

---

## 5. Pre-Spec Spatial Reasoning & StageSpec Contract

Before generating the final JSON, formulate the structured **StageSpec** contract:

1. **Active World Bounds**: Determine bounding box extents $(X_{min}, X_{max}, Z_{min}, Z_{max})$ within $\pm 50.0\text{m}$.
2. **Functional Zoning**: Partition the area into circulation corridors, building plots, and plazas.
3. **Actor-Aware Clearance Contract**:
   - **Car Corridor (`actor_type: 'car'`)**: Road lanes minimum width $\ge 4.0\text{m}$ (`sx = 4.0`), ramp pitch between $10^\circ$ and $25^\circ$ ($0.17$ to $0.43$ rad), overpass vertical clearance $P_y \ge 3.5\text{m}$.
   - **Human Corridor (`actor_type: 'human'`)**: Door openings $\ge 1.2\text{m}$ wide $\times 2.2\text{m}$ high, stair steps $\approx 0.2\text{m}$ height $\times 0.4\text{m}$ depth.
4. **Anchor & Attachment Hierarchy**: Secondary attached elements (tables, roofs, signs) must compute exact relative top surface heights ($Y_{top} = P_y + S_y / 2.0$) to avoid floating disconnected geometry.

---

## 6. StageState Schema Specification (cube_stage)

Stages consumed by `StagingNode` (`UBStagingNode`) adhere to the standard `StageState` JSON schema:

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

## 7. QC Loop — Never Skip, Iterate Until Green (Expect 2–4 Iterations)

Never deliver an unverified or failing JSON stage to the user. Every generated or modified JSON stage **MUST pass the deterministic quality gate with 100% GREEN (0 errors, 0 misalignments)** before being presented.

```bash
# Deterministic quality inspection (must yield 0 bounds errors, 0 misalignments)
python3 skills/stage-builder/scripts/staging_utils.py <preset>.json --inspect
```

### The Autonomous Iterative Loop:
1. **Run Inspection Gate**:
   - Executes structural schema validation (`cube_stage`), hierarchy traversal, world boundary verification ($\pm 50.0\text{m}$), and ground contact check ($P_y = S_y / 2$ on base ground objects).
2. **If ANY Quality Gate Fails or Errors Occur**:
   - **DO NOT STOP** and report failure to the user.
   - For ground level discrepancies, run auto-fix:
     ```bash
     python3 skills/stage-builder/scripts/staging_utils.py <preset>.json --fix-ground -o <preset>.json
     ```
   - For world boundary violations ($>50\text{m}$) or inverted coordinate axes, re-proportion or flip:
     ```bash
     python3 skills/stage-builder/scripts/staging_utils.py <preset>.json --flip-x -o <preset>.json
     ```
   - Re-run `staging_utils.py <preset>.json --inspect`.
   - **Iterate autonomously 2–4 times until 100% GREEN [✓ PASS] (0 bounds issues, 0 ground misalignments)**.
3. **Delivery**:
   - Only when the ASCII report confirms `0 bounds issues, 0 ground misalignments` may the agent deliver the result to the user.

---

## 8. File Naming & Isolated Workspace Pattern

- Stage and preset filenames **MUST be in English**, lowercase with underscores:
  - `<stage_name>.json` (e.g. `urban_alley.json`, `abandoned_station.json`, `temple_ruins.json`)
- Presets reside in `presets/` or in ComfyUI's `input/staging_stages/` directory.
- **Isolated Workspace Pattern**: If helper Python scripts are created to procedurally generate, transform, or calculate coordinates for a JSON stage, place them in `stages/<stage_name>/build_stage.py`. The `stages/` directory is registered in `.gitignore`, keeping temporary generation scripts out of the git repository.
