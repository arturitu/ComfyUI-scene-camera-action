# 📁 Example Workflows for ComfyUI-scene-camera-action

This folder contains pre-configured, ready-to-use workflows for **ComfyUI-scene-camera-action**.

---

## 🚀 How to Load a Workflow

You have two easy ways to open any workflow in ComfyUI:

1. **Drag & Drop**: Drag any `.json` file from this folder directly into your ComfyUI browser window.
2. **Load Menu**: In ComfyUI, click **Load** on the control panel, navigate to `custom_nodes/ComfyUI-scene-camera-action/examples/`, and select the `.json` file.

---

## 📦 Included Workflows

### 1. `basic_previz_workflow.json` (Recommended for Beginners)
- **Preset**: `race_track.json` loaded by default with configured starting grid spawn point.
- **Actor**: 🚗 **Car Actor** (dynamic vehicle physics, acceleration, and drift).
- **What it does**: Sets up a complete 3D Previz pipeline: **Staging ➔ Acting ➔ Directing ➔ Save Video** with step-by-step guidance notes.
- **AI Integration**: Includes instructions on how to use the captured 720p HD video as reference for **Seedance 2.5 / Seedance 2.0 Fast** or **MiniMax H3**.
- **Requirements**: **0 external AI model downloads required!** Test immediately upon installing.

### 2. `multi_actor_workflow.json`
- **Preset**: `industrial_ruin.json` loaded by default with warehouse geometry and ramps.
- **Actors**: 🚶 **Human** (Actor 1) + 🐕 **Quadruped** (Actor 2) with dedicated, non-overlapping spawn points.
- **What it does**: Sequences multiple actors in series with synchronized live ghost replays during recording, plus AI reference video integration notes.

---

👉 *Need help or want to create 3D sets with natural language? See the main [README.md](../README.md).*
