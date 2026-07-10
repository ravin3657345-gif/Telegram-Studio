import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";

// Two ways Rich mode can present 2+ adjacent images/videos — see BlockImage.tsx
// / BlockVideo.tsx for the toggle UI and richMessageConverter.ts for the
// <tg-collage>/<tg-slideshow> output. Irrelevant outside Rich publish mode.
export type MediaGroupLayout = "collage" | "slideshow";

export function isMediaGroupNode(node: PMNode | null | undefined): boolean {
  return !!node && (node.type.name === "blockImage" || node.type.name === "blockVideo");
}

// Whether the node at `pos` sits directly next to another image/video block —
// i.e. whether it's part of a run that will actually be grouped on publish.
export function isInMediaGroup(editor: Editor, pos: number): boolean {
  const $pos = editor.state.doc.resolve(pos);
  const parent = $pos.parent;
  const index = $pos.index();
  const prev = index > 0 ? parent.child(index - 1) : null;
  const next = index < parent.childCount - 1 ? parent.child(index + 1) : null;
  return isMediaGroupNode(prev) || isMediaGroupNode(next);
}

// Flips collage<->slideshow for the ENTIRE contiguous run this node belongs
// to (not just this one node) so a group never ends up with mixed layouts.
export function toggleMediaGroupLayout(editor: Editor, pos: number) {
  const { doc } = editor.state;
  const $pos = doc.resolve(pos);
  const parent = $pos.parent;
  const parentStart = $pos.start();
  const index = $pos.index();

  let startIndex = index;
  while (startIndex > 0 && isMediaGroupNode(parent.child(startIndex - 1))) startIndex--;
  let endIndex = index;
  while (endIndex < parent.childCount - 1 && isMediaGroupNode(parent.child(endIndex + 1))) endIndex++;

  const current = (parent.child(index).attrs.groupLayout as MediaGroupLayout) || "collage";
  const next: MediaGroupLayout = current === "collage" ? "slideshow" : "collage";

  const tr = editor.state.tr;
  let childPos = parentStart;
  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i);
    if (i >= startIndex && i <= endIndex) {
      tr.setNodeAttribute(childPos, "groupLayout", next);
    }
    childPos += child.nodeSize;
  }
  editor.view.dispatch(tr);
}
