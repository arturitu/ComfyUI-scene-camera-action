# ComfyUI-scene-camera-action

An interactive 3D scene creation, character acting, and camera directing set of custom nodes for **ComfyUI**. 

Build your 3D environment, control and record character movements using your keyboard in real time, and compose live camera cuts between multiple camera angles (TPV, FPV, Wide, Side) to generate high-fidelity reference video and stage image for video-to-video (such as Seedance 2.0) workflows.

![Preview](img.png)

---

## Workflow Nodes Breakdown

### 1. Staging 3D Node
Build your 3D environment by placing, editing, duplicating, and transforming 3D assets:
- **Interactive 3D Viewport**: Pan, rotate, and zoom using MapControls.
- **3D Gizmo Manipulators**: Move (translate), rotate, and scale boxes on all axes.
- **Asset Duplication (`❐`)**: Instantly clone selected assets with identical scale and orientation with automatic offset.
- **Output**: Sends `Scene Data` downstream to the Acting node.

### 2. Acting 3D Node
Control your character in real time and record movement trajectories:
- **Keyboard Control**: Drive the character capsule across the stage using Arrow keys.
- **Motion Recording**: Play and record character locomotion trajectories over a customizable duration (e.g. 7 seconds).
- **Output**: Combines scene geometry and recorded motion into `Acting Data` for the Directing node.

### 3. Directing 3D Node
Compose your sequence with live multi-camera cuts:
- **Multi-Camera Modes**: Cut seamlessly between:
  - **TPV (Third-Person View)**: Follows behind the character.
  - **FPV (First-Person View)**: Immersive POV from character head height.
  - **Wide**: Static overview camera framing the action.
  - **Side**: Tracking side-profile camera following the character.
- **Timeline Keyframing**: Add and adjust camera cuts along the playback timeline.
- **Outputs**:
  - **`Captured Video` (`VIDEO`)**: 720p HD recorded video of the directed camera sequence.
  - **`Captured Stage` (`IMAGE`)**: 720p stage overview snapshot capturing the initial state (`t=0.0s`) of the entire scene.

---

## Installation

### Option 1: ComfyUI Manager (Recommended)
Search for `ComfyUI-scene-camera-action` in ComfyUI Manager and click Install.

### Option 2: Manual Clone
Clone this repository directly into your ComfyUI `custom_nodes` directory:

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/arturitu/ComfyUI-scene-camera-action.git
```

Restart your ComfyUI server after installation.

---

## License

MIT License. Built for creator workflows.
