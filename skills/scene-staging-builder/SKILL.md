---
name: scene-staging-builder
description: Turn any natural language description or reference image into a 3D staging scene (graybox/blockout composition) strictly using transformed 3D Box primitives for ComfyUI-scene-camera-action. Agent-guided specification for spatial reasoning, 4-layer scene decomposition, actor-aware layout design, and iterative JSON modification.
license: Apache-2.0
version: 1.1.0
---

# scene-staging-builder — 3D Scene & Staging AI Skill

Convert any text prompt, natural language request, or reference image into a clean, proportioned 3D staging scene built **strictly using transformed 3D Box primitives** (`type: 'block'` and `type: 'group'`) for the **ComfyUI-scene-camera-action** ecosystem.

---

## 1. Core Rule: 100% Box Primitive Constraint

Every object, wall, roof, prop, vehicle part, tree, animal limb, or furniture piece in the generated scene **MUST be created using 3D Box primitives** (`type: 'block'`).
- Do **NOT** rely on external `.gltf` / `.obj` meshes or non-box shapes.
- Use spatial scaling (`sx, sy, sz`), rotation (`rx, ry, rz` in radians), positioning (`px, py, pz`), and grouping (`type: 'group'`) to construct any form (slopes, columns, arches, steps, roofs, vehicles, characters, animals).

---

## 2. 3D Coordinate System, Ground Alignment & World Bounds

### Axes
- $X$: Left (-) to Right (+)
- $Y$: Vertical height. Ground level is at $Y = 0.0$
- $Z$: Back (-) to Front / Depth (+)

### Floor — DO NOT Generate
The 3D viewport already contains a built-in floor plane and grid at $Y = 0$. **Do NOT add any floor, ground plane, terrain base, or ground slab block** to the generated scene JSON. The floor is always present automatically.

### Ground Alignment Rule
- Box position $(P_x, P_y, P_z)$ defines the **center** of the box.
- A block resting directly on the ground level ($Y=0$) with height $S_y$ **MUST** have $P_y = S_y / 2.0$.
- Example: A wall of height 4.0 resting on the ground has $P_y = 2.0$.
- **Critical**: Any asset that should sit on the ground (buildings, furniture legs, tree trunks, vehicles, fences, etc.) must have its $P_y$ calculated as $S_y / 2.0$ so its bottom face touches $Y = 0$ exactly. Never place ground-resting objects at $P_y = 0$ unless $S_y = 0$.

### World Bounds
- The usable scene area is **100 × 100 meters** centered at the origin, spanning from $(-50, 0, -50)$ to $(50, Y_{max}, 50)$.
- Keep all generated assets within this boundary.
- Typical scenes should use a much smaller region (e.g., 20×20m for an interior, 40×40m for a street block) unless the prompt explicitly requires a large landscape.

---

## 3. Actor-Aware Spatial Proportions

Since scenes created with this Skill are consumed by **Acting 3D Node** (`ActingNode`), design layouts with realistic scale for interactive actors:

- **Car Actor (`actor_type: 'car'`)**:
  - Road width: Minimum 4.0 units wide (`sx = 4.0`).
  - Ramp inclines: Slope pitch angle `rx` between $10^\circ$ and $25^\circ$ ($0.17$ to $0.43$ rad).
  - Clearances: Overpasses and bridges must have $P_y \ge 3.5$ clearance.
- **Human Actor (`actor_type: 'human'`)**:
  - Doorway dimensions: Width $\approx 1.2$, Height $\approx 2.2$.
  - Stair steps: Step height $\approx 0.25$, Depth $\approx 0.5$.

---

## 4. Blockout Breakdown Pipeline (4-Layer Hierarchy)

When given a text prompt or reference image, decompose the 3D scene into 4 structured layers:

### Layer 1: Environment Base (NO floor needed)
- Terrain steps, foundation pads, roads, elevated platforms, pedestals.
- Do **NOT** generate a ground/floor block — it already exists in the viewport.
- Form the spatial boundaries for the actors.

### Layer 2: Main Structural Volumes
- Primary architectural walls, building bodies, vehicle hulls, room enclosures, large furniture frames, hill slopes.
- Form the overall silhouette and spatial bounds of the subject.

### Layer 3: Secondary Forms & Secondary Props
- Roof overlays, pillars/columns, doors, windows, tables, chairs, tree trunks + foliage crowns, animal bodies + limbs, wheels, wings, ramp inclines.
- Group related components into logical `group` nodes (e.g., `House`, `Deer`, `RaceTrackSegment`, `Bed`).

### Layer 4: Accent Details & Highlights
- Chimneys, handles, trim lines, obstacles, barriers, antlers, lamps, small props.

---

## 5. SceneState Schema Specification & Spawn Point

Every generated scene MUST strictly adhere to the `SceneState` JSON schema used by `SceneNode` and `ActingNode`.
Generators SHOULD include a `spawn_point` object defining where the 3D actor spawns and its initial heading angle `ry` (in radians).

### Actor Spawn Point Placement Guidelines
- **Car Actor (`actor_type: 'car'`)**: Place spawn point at the start of the road, lane, or track. Set `ry` facing along the direction of travel.
- **Human Actor (`actor_type: 'human'`)**: Place spawn point at a doorway entrance, pathway start, or key room threshold facing into the main space.
- **Ground height**: Set `py = 0.0` for ground level resting.

```json
{
  "type": "cube_scene",
  "num_assets": 12,
  "spawn_point": {
    "px": 0.0,
    "py": 0.0,
    "pz": 5.0,
    "ry": 0.0
  },
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

---

## 6. File Naming Convention

All generated preset JSON filenames **MUST be in English**, using lowercase with underscores:
- `forest_scene.json`, `urban_street.json`, `living_room.json`, `race_track.json`
- Do **NOT** use Spanish, accented characters, or spaces in filenames.

---

## 7. Iterative Editing Protocol

When the user requests modifications or adjustments to an existing 3D scene (e.g. *"make the deer bigger"*, *"add a ramp at the end"*, *"move the table 2 meters to the left"*):

1. **Parse Existing State**: Read and inspect the current `SceneState` JSON.
2. **Target Node Identification**: Locate the node or group by its `id` or `name`.
3. **Apply Delta Modifications**:
   - **Transform Changes**: Update `px, py, pz`, `rx, ry, rz`, or `sx, sy, sz` of the target node.
   - **Additions**: Construct new child `block` or `group` nodes following the 4-layer pipeline and append them to the appropriate parent.
   - **Deletions**: Remove specified nodes from the tree.
4. **Re-validate Ground Alignment**: Ensure all ground-resting objects maintain $P_y = S_y / 2.0$ and no invalid numbers exist. Do not add floor blocks.
5. **Output Clean JSON**: Return the updated, fully-valid `SceneState` JSON.
