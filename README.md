# ComfyUI-scene-camera-action

> [!NOTE]
> **ComfyUI-scene-camera-action (v0.5.0)** by [@arturitu](https://github.com/arturitu) / [Unboring.net](https://unboring.net).

An interactive 3D scene staging, actor acting, and camera directing suite of custom nodes for **ComfyUI**.

Build your 3D environment, control and record actor movements in real time using your keyboard, and compose live camera cuts between multiple camera angles (TPV, FPV, Wide, Side) to generate high-fidelity reference video and stage imagery for reference-to-video (such as Seedance or MiniMax) workflows.

![Preview](img.png)

---

## 🚀 Release History

### 🚀 Shipped - v0.5.0: Quadruped Actor (Current Version)
- **Rigged Quadruped Actor**: New 4-legged animal archetype (`QuadrupedActor`) with full locomotion animations (idle, walk, run, sit/crouch) built on `SkinnedActor`.
- **Configurable Actor Scaling**: Adjust actor sizes dynamically with automatic camera framing and speed scaling.
- **Practice Rehearsal Mode**: Loop actor movement in real time to test trajectories before recording.
- **Demand-Based GPU Rendering**: Pauses WebGL rendering during graph navigation for lightweight performance.
- **Stage Distance Fading & UI Upgrades**: Smooth edge fading, modern Lucide icons, and optimized node payloads.


### 📦 Shipped - v0.4.0: Multiple Actors
- **Multi-Actor Chaining**: Sequence and record multiple independent actors (humanoids and vehicles) on the same stage with synchronized playback.
- **Camera Spring Arm (Anti-Collision)**: Real-time obstacle avoidance prevents camera clipping against walls and geometry during dynamic camera moves.
- **Actor Color Customization**: Dynamic mesh coloring to visually distinguish different actors across the 3D viewport and node timeline.
- **Universal Stage Builder**: Universal 3D geometric engine with 5 core primitives and new presets (`courthouse_square`, `gas_station`).
- **Vue.js Architecture**: Modernized modular reactive UI components (`StagingWidget`, `ActingWidget`, `DirectingWidget`).

https://github.com/user-attachments/assets/2d03f9fe-42a2-4472-9543-373252dcf670


### 📦 Shipped - v0.3.0: Animated Humanoid
- **Animated 3D Humanoid Model**: Custom 3D human model with bone structure and armature animations.
- **Configurable Spawn Points**: UI selection for actor starting locations across Staging and Acting nodes.
- **3D Scene Presets**: Built-in previz tracks (`liberty_beach`, `industrial_ruin`, `warehouse`, `test-collider`).

https://github.com/user-attachments/assets/590b10b8-fe3f-4f4b-b1be-99f3fc646010

👉 [*See it in action on LinkedIn*](https://www.linkedin.com/feed/update/urn:li:activity:7491165268455481345/)

### 📦 Shipped - v0.2.0: Car Actor
- **Natural Language 3D Scene Builder (`SKILL.md`)**: Transform prompts or reference images into 3D stage compositions using any AI coding assistant.
- **Multi-Archetype Actor Physics Engine**: Support for Humanoid and Vehicle (`CarActor`) movement physics.
- **Hierarchical Scene Management**: Grouping (`Group`/`Ungroup`), multi-selection, and transform snapping.

https://github.com/user-attachments/assets/fc99bde7-7900-4fb1-9181-6c82dc451373

👉 [*See it in action on LinkedIn*](https://www.linkedin.com/feed/update/urn:li:activity:7488962940134481920/)

### 📦 Shipped - v0.1.0: Starting Point
- **Initial PoC Custom Nodes**: Proof-of-concept custom nodes (`Staging`, `Acting`, `Directing`).
- **Basic 3D Prev-viz**: Asset placement, single capsule actor control, and multi-camera timeline cuts.

https://github.com/user-attachments/assets/fde67050-c33d-406c-87e5-64b9d0544381

👉 [*See it in action on LinkedIn*](https://www.linkedin.com/feed/update/urn:li:activity:7486069273581400064/)

---

## 🛠️ Workflow Nodes Breakdown (`scene-camera-action`)

https://github.com/user-attachments/assets/dd5c0d21-573a-467f-9d4b-1218e2c90cac

### 1. Staging (`StagingNode`)
Build your 3D environment by placing, editing, grouping, duplicating, and transforming 3D assets:
- **Interactive 3D Viewport**: Orbit, pan, and zoom using standard MapControls.
- **Hierarchical Selection & Grouping**: Select multiple items with `Shift + Click`, group (`Group`) or ungroup (`Ungroup`) complex structures.
- **3D Transform Gizmos**: Move, rotate, and scale assets on all axes with optional `Shift` snapping.
- **Asset Duplication (`❐`)**: Instantly clone selected assets or groups.
- **Preset Loader**: Load built-in 3D scenes or custom JSON presets directly from the UI dropdown.
- **Output**: Sends `Stage Data` downstream to the Acting node.

### 2. Acting (`ActingNode`)
Control actors in real time and record movement trajectories across the 3D stage:
- **Archetype & Scale**: Choose between **Human** (rigged humanoid), **Car** (vehicle physics), and **Quadruped** (4-legged animal), with dynamic actor scaling ($0.2\times - 3.0\times$).
- **Practice & Recording**: Rehearse movement loops in practice mode and record trajectories in real time using `WASD` / arrow keys.
- **Speed, Color & Duration**: Configure locomotion speed ($1.0 - 30.0$), actor identification colors, and recording duration ($4.0\text{s} - 15.0\text{s}$).
- **Output**: Combines scene geometry, actor archetypes, and chained trajectories into `Acting Data`.

### 3. Directing (`DirectingNode`)
Compose your cinematic sequence with live multi-camera cuts along a visual playback timeline:
- **Smart Multi-Camera Shots**: TPV, FPV, Tracking Side, and Auto-Framing Master Wide with anti-collision **Spring Arm** obstacle avoidance.
- **Dynamic Framing & Distance**: Per-shot camera distance controls, auto-framing, and smooth actor tracking.
- **Timeline Keyframing**: Add, move, and edit camera cuts with real-time multi-actor preview and pause freeze.
- **Output**: Sends 720p HD `Captured Video` (`VIDEO`) directly downstream to reference-to-video models (such as Seedance or MiniMax).

---

## 🤖 Transform Prompts into 3D Scenes (`SKILL.md`)

Generate proportioned 3D previz scenes from natural language prompts or reference images using the included `stage-builder` skill with any AI coding agent (**Antigravity**, **Claude Code**, **Codex**, **Cursor**, **Pi**, etc.).

![Natural Language 3D Scene Builder](img2.jpg)

The [`skills/stage-builder/SKILL.md`](skills/stage-builder/SKILL.md) instruction set equips AI coding assistants with 3D spatial reasoning to output clean 3D `SceneState` JSON preset files saved to `presets/`.

---

## 💻 Installation

Clone this repository directly into your ComfyUI `custom_nodes` directory:

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/arturitu/ComfyUI-scene-camera-action.git
cd ComfyUI-scene-camera-action
pip install -r requirements.txt
```

#### Windows Portable:
If you are using `ComfyUI_windows_portable`, run this from your portable root folder:
```bash
python_embeded\python.exe -m pip install -r ComfyUI\custom_nodes\ComfyUI-scene-camera-action\requirements.txt
```

Restart your ComfyUI server after installation.

---

## 📄 License

MIT License. Built by [@arturitu](https://github.com/arturitu) / [Unboring.net](https://unboring.net).
