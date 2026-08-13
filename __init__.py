import os
from .nodes import comfy_entrypoint, NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

# Register the js directory for web extensions
custom_node_dir = os.path.dirname(os.path.realpath(__file__))
js_dir = os.path.join(custom_node_dir, "js")

try:
    import nodes
    nodes.EXTENSION_WEB_DIRS["ComfyUI-UB-3D-Studio"] = js_dir
except Exception:
    pass

__all__ = ["comfy_entrypoint", "NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]

