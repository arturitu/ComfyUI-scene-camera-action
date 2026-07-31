# ComfyUI-scene-camera-action

> [!WARNING]
> This is an experimental release tested locally. It serves as an advanced 3D spatial reference and Prev-viz toolkit for 3D-driven video-to-video (V2V) workflows.

An interactive 3D scene creation, actor acting, and camera directing suite of custom nodes for **ComfyUI**.

Build your 3D environment, control and record actor movements in real time using your keyboard, and compose live camera cuts between multiple camera angles (TPV, FPV, Wide, Side) to generate high-fidelity reference video and stage imagery for video-to-video (such as HunyuanVideo, Wan2.1, or AnimateDiff) workflows.

![Preview](img.png)

---

## Release History

### 🚀 Shipped - v0.2.0 (Current Version)
- **Natural Language 3D Scene Builder (`SKILL.md`)**: Transform prompts or reference images into 3D stage compositions using any AI coding assistant.
- **Multi-Archetype Actor Physics Engine**: Support for Humanoid and Vehicle (`CarActor`) movement physics, multi-probe suspension, and steering.
- **Hierarchical Scene Management**: Grouping (`Group`/`Ungroup`), multi-selection, and transform snapping in the Staging Node.
- **Smart Dynamic Camera System**: Zero-clipping FPV and auto-framing Master Wide Camera.
- **High-Fidelity Captures**: 1:1 initial frame stage snapshot matching camera view, FOV, and atmosphere.
- **3D Scene Presets**: Built-in previz tracks (`space_platform_track.json`, `race_track.json`, `varied_forest.json`).

### 📦 Shipped - v0.1.0 (Initial PoC Release)
- Initial proof-of-concept custom nodes (`SceneNode`, `ActingNode`, `DirectingNode`).
- Basic 3D asset editing, single human capsule actor, and timeline camera cuts.

---

## 🤖 Transform Prompts into 3D Scenes (`SKILL.md`)

Generate proportioned 3D previz scenes from natural language prompts or reference images using the included `scene-staging-builder` skill with any AI coding agent (**Antigravity**, **Claude Code**, **Codex**, **Cursor**, **Pi**, etc.).

![Natural Language 3D Scene Builder](img2.jpg)

### How It Works
The [`skills/scene-staging-builder/SKILL.md`](file:///Users/unboring/Documents/antigravity/ComfyUI-scene-camera-action/skills/scene-staging-builder/SKILL.md) instruction set equips AI coding assistants with:
- **3D Spatial Reasoning & Scaling**: Strict 100% box primitive decomposition rules for any architectural or prop form.
- **Automatic Ground Alignment Math**: Ensures all ground-resting objects enforce $P_y = S_y / 2.0$ without floor clipping.
- **Actor-Aware Clearance Rules**: Proportioned road widths, ramp inclines, overpass clearances, and stair steps for car and human actors.
- **Iterative Modifiers**: Add, scale, shift, or delete specific 3D groups via natural conversational instructions.

**Example Prompts for AI Agents:**
> *"Create a space adventure motocross track with a launch pad, mega kicker ramp, skate halfpipe, and high-orbit finish gate."*

> *"Build a dense varied forest with ancient pine trees, mossy rocks, fallen tree trunks, and bushes."*

The AI assistant outputs clean 3D `SceneState` JSON preset files saved to `presets/` that immediately appear in the **Staging 3D Node** for interactive editing and previz.

---

## 🛠️ Workflow Nodes Breakdown

### 1. Staging 3D Node (`SceneNode`)
Build your 3D environment by placing, editing, grouping, duplicating, and transforming 3D assets:
- **Interactive 3D Viewport**: Orbit, pan, and zoom using standard MapControls.
- **Hierarchical Selection & Grouping**: Select multiple items with `Shift + Click`, group (`Group`) or ungroup (`Ungroup`) complex structures.
- **3D Transform Gizmos**: Move, rotate, and scale assets on all axes with optional `Shift` snapping.
- **Asset Duplication (`❐`)**: Instantly clone selected assets or groups.
- **Preset Loader**: Load built-in 3D scenes or custom JSON presets directly from the UI dropdown.
- **Output**: Sends `Scene Data` downstream to the Acting node.

### 2. Acting 3D Node (`ActingNode`)
Control your actor in real time and record movement trajectories across the 3D stage:
- **Archetype Selection**: Switch between **Human** (capsule physics) and **Car** (vehicle physics).
- **Real-Time Keyboard Control**: Drive or walk the actor using `WASD` or `Arrow` keys.
- **Speed & Duration Control**: Adjust actor speed ($1.0 - 20.0$) and recording duration ($4.0\text{s} - 15.0\text{s}$).
- **Motion Recording**: Record actor locomotion trajectories and auto-play recorded loops.
- **Output**: Combines scene geometry, actor type, and motion trajectory into `Acting Data` for the Directing node.

### 3. Directing 3D Node (`DirectingNode`)
Compose your sequence with live multi-camera cuts along a visual playback timeline:
- **Smart Multi-Camera Modes**: TPV (Third-Person), FPV (First-Person), Wide (Auto-Framing Master), and Side (Tracking).
- **Timeline Keyframing**: Add, move, and adjust camera cuts along the playback timeline.
- **Outputs**:
  - **`Captured Video` (`VIDEO`)**: 720p HD recorded video of the directed camera sequence.
  - **`Captured Stage` (`IMAGE`)**: 720p stage overview image capturing the exact initial frame ($t = 0.0\text{s}$) camera view.

---

## 💻 Installation

Clone this repository directly into your ComfyUI `custom_nodes` directory:

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/arturitu/ComfyUI-scene-camera-action.git
```

Restart your ComfyUI server after installation.

---

## 📄 License

MIT License. Built for creator workflows.
