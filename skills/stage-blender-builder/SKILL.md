---
name: stage-blender-builder
description: Build a cinematic stylized 3D clay environment in Blender (headless CLI) for ComfyUI-scene-camera-action. Creates rich architectural spaces (colonnades, arches, vaults, bevels, grand stairs, props) with a unified matte clay material (#c9c9cf) and exports metric GLB stages ready for staging, acting, and directing.
---

# Clay Stage Builder — Cinematic 3D Environment in Blender

Builds a stylized 3D clay architectural environment in Blender headlessly, saved as a master `.blend` and exported to metric `.glb` for ComfyUI camera directing and actor staging.

## Step 0 — ALWAYS ask the user first

Never assume the environment geometry. When the user provides a prompt or reference image:
1. **Extract 3–5 spatial facts**:
   - **Environment & Style**: (e.g. Beaux-Arts rail terminal concourse, gothic cloister, cyberpunk stepped harbor).
   - **Hero Landmarks**: 2–4 primary focal structures (e.g. trio of colossal arched windows, central imperial staircase, clock kiosk).
   - **Scale & Vertical Hierarchy**: Ground dimensions, mezzanine tiers, ceiling height, circulation voids.
2. **Structured Questionnaire**: Present 2–3 multiple-choice questions confirming scale and key landmark placement.

### 🛑 MANDATORY HARD STOP
Stop calling tools immediately and wait for the user's explicit reply before generating any code or running Blender.

## Scene Construction Rules (Film-Grammar)

- **Headless Execution**: `/Applications/Blender.app/Contents/MacOS/Blender --factory-startup -b -P stages/<stage_name>/build_stage.py`.
- **Real-World Metric Scale**: $1\\text{ BU} = 1.0\\text{ m}$. Walkable ground at $Z = 0.0\\text{ m}$ ($Y = 0.0\\text{ m}$ in GLB). World bounds $\\pm 50.0\\text{ m}$, max height $\\le 30.0\\text{ m}$.
- **Density Sells the World**: $\\ge 200..500$ objects for complex environments (plinths, pilasters, balustrades, moldings, window transoms).
- **3 Depth Layers**: Near (foreground wipes: curbs, portals, trees), Mid (hero subject & staging), Far (skyline silhouette).
- **Natural 3D Architectural Primitives**:
  - Walls & floors: beveled prisms.
  - Columns, turrets & shafts: smooth cylinders (`vertices=32..48`) with beveled caps.
  - Arches & portals: carve smooth semicircular apertures using Boolean Difference with horizontal cylinders (`vertices=32..64`).
  - Domes & vaults: half-spheres or half-cylinders with Solidify and Bevel.
- **Clay Aesthetic**: Bevel modifier on hero meshes (`width=0.02..0.04m`, 2–3 segments, angle limit $30^\\circ$, `harden_normals=True`).
- **Clay_Matte Material**: Base color `#c9c9cf` (sRGB `[0.788, 0.788, 0.812, 1.0]`), Roughness `1.0`, Metallic `0.0`, Specular `0.2`, IOR `1.45`. Zero textures.
- **5 Collections**: `01_Terrain_Ground`, `02_Architecture_Primary`, `03_Architecture_Secondary`, `04_Props_Vegetation`, `05_Spawn_Navigation`.
- **Output & Persistence**:
  - Save master project: `stages/<stage_name>/<stage_name>.blend` (preserves live modifiers).
  - Export production GLB: `stages/<stage_name>/<stage_name>.glb` (`export_apply=True`, `export_yup=True`, `export_materials="EXPORT"`).

## 🛑 Checkpoint Gate V1 (Review & Fork)

Immediately after producing the initial `.blend`, `.glb`, and `preview.png`, **STOP CALLING TOOLS**.
Show `preview.png` and ask the user how to proceed:
1. **Option 1 (Interactive Blender GUI + MCP)**: User opens `stages/<stage_name>/<stage_name>.blend` and clicks 'Connect' to make live tweaks together. (Auto-saves `.blend` and re-exports `.glb` on every change).
2. **Option 2 (Headless Background)**: Agent continues refining `build_stage.py` headlessly.
3. **Option 3 (Approve)**: Copy `.glb` to `presets/` for ComfyUI.

## QC Loop — Never Skip

Run: `python scripts/validate_clay_stage.py stages/<stage_name>/<stage_name>.glb --render stages/<stage_name>/preview.png`
- Validates: bounds within $\\pm 50\\text{m}$, ground at $Y \\ge -0.05\\text{m}$, clay material, 0 missing textures, and renders a 1280×720 Workbench Clay snapshot.
- Iterate autonomously until all 6 gates pass [✓ PASS].
