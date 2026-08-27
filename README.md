# ComfyUI-scene-camera-action
by [@arturitu](http://linkedin.com/in/arturoparacuellos) / [Unboring.net](https://unboring.net).

An interactive 3D scene staging, actor acting, and camera directing suite of custom nodes for **ComfyUI**.

Stop prompting movement into a black box. **ComfyUI-scene-camera-action** turns AI video generation into a directable, playable studio:

- **1. Staging:** Build navigable 3D blockout sets with instant colliders — manually or via AI prompts (`SKILL.md`).
- **2. Acting:** Playable `WASD` controls & multi-track actor chaining with live ghost replays (no keyframing).
- **3. Directing:** Live camera cuts with anti-collision **Spring Arm**, outputting 720p HD reference video (`VIDEO`) for models like Wan, HunyuanVideo, or MiniMax.

👉 *See full details and controls in the [Workflow Nodes Breakdown](#workflow-nodes-breakdown).*

![Preview](scene-camera-action.png)

---

## 🚀 Release History

### 🚀 Shipped - v0.5.0: Quadruped Actor (Current Version)
- **Rigged Quadruped Actor**: New 4-legged animal archetype (`QuadrupedActor`) with full locomotion animations (idle, walk, run, sit/crouch) built on `SkinnedActor`.
- **Configurable Actor Scaling**: Adjust actor sizes dynamically with automatic camera framing and speed scaling.
- **Practice Rehearsal Mode**: Loop actor movement in real time to test trajectories before recording.
- **Demand-Based GPU Rendering**: Pauses WebGL rendering during graph navigation for lightweight performance.
- **Stage Distance Fading & UI Upgrades**: Smooth edge fading, modern Lucide icons, and optimized node payloads.

https://github.com/user-attachments/assets/d8abce40-8af8-486d-b8ac-fbcf2a661968


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

<a id="workflow-nodes-breakdown"></a>
## 🛠️ Workflow Nodes Breakdown (`scene-camera-action`)

https://github.com/user-attachments/assets/dd5c0d21-573a-467f-9d4b-1218e2c90cac

### 1. Staging (`StagingNode`)
Build your 3D environment by placing, editing, grouping, duplicating, and transforming 3D assets:
- **Interactive 3D Viewport**: Orbit, pan, and zoom using standard MapControls.
- **Hierarchical Selection & Grouping**: Select multiple items with `Shift + Click`, group (`Group`) or ungroup (`Ungroup`) complex structures.
- **3D Transform Gizmos**: Move, rotate, and scale assets on all axes with optional `Shift` snapping.
- **Asset Duplication**: Instantly clone selected assets or groups.
- **Preset Loader**: Load built-in 3D scenes or custom JSON presets directly from the UI dropdown.
- **Output**: Sends `Stage Data` downstream to the Acting node.

### 2. Acting (`ActingNode`)
Play and record actor performances in real time across the 3D stage:
- **Game-Like WASD Controls**: Drive vehicles or move characters in real time with physics and collision detection. Includes a **Practice Rehearsal Mode** to test movement loops before recording.
- **Multi-Track Actor Chaining**: Connect multiple Acting nodes in series. Sequence and choreograph independent actors while watching live synchronized ghost replays of previous takes.
- **3 Actor Archetypes**: **Human** & **Quadruped** (rigged with animations based on [Mesh2Motion](https://github.com/Mesh2Motion/mesh2motion-app)), and **Car** (vehicle steering physics).
- **Customization & Scale**: Adjust actor scales dynamically ($0.3\times - 2.0\times$), color-code actors for easy identification, and customize movement speeds.
- **Output**: Combines stage geometry, actor rigs, and chained trajectories into `Acting Data`.

### 3. Directing (`DirectingNode`)
Compose your cinematic sequence with live multi-camera cuts along a visual playback timeline:
- **Anti-Collision Spring Arm**: Real-time obstacle avoidance prevents camera clipping against walls and geometry during dynamic camera moves.
- **Smart Multi-Camera Rigs**: Switch between TPV (Third-Person), FPV (First-Person), Tracking Side, and Auto-Framing Master Wide.
- **Visual Cut Timeline**: Add, move, and edit camera cuts on the fly with live multi-actor playback and pause freeze.
- **Direct-to-Generative Output**: Sends 720p HD `Captured Video` (`VIDEO`) directly downstream to reference-to-video models (such as Wan, HunyuanVideo, MiniMax, or Seedance).

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
