import os
import nodes

# Register the js directory for web extensions
custom_node_dir = os.path.dirname(os.path.realpath(__file__))
js_dir = os.path.join(custom_node_dir, "js")
nodes.EXTENSION_WEB_DIRS["ComfyUI-scene-camera-action"] = js_dir

from .nodes import comfy_entrypoint
