/**
 * Serializes Excalidraw elements into a compact text format suitable
 * for Gemini Live context injection.
 */

export interface ExcalidrawSimpleElement {
  id: string;
  type: string;
  isDeleted?: boolean;
  text?: string;
  containerId?: string | null;
  boundElements?: Array<{ id: string; type: string }> | null;
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
  [key: string]: unknown;
}

/**
 * Resolves the label text for a given shape element.
 * Checks both child text elements with containerId === shape.id,
 * and text elements referenced in shape.boundElements.
 */
export function getShapeLabel(
  shape: ExcalidrawSimpleElement,
  elementsById: Map<string, ExcalidrawSimpleElement>
): string {
  // If the element itself is a text element and has text
  if (shape.type === 'text' && shape.text && shape.text.trim().length > 0) {
    return shape.text.trim();
  }

  // Check boundElements referencing a text element
  if (shape.boundElements && Array.isArray(shape.boundElements)) {
    for (const bound of shape.boundElements) {
      if (bound.type === 'text') {
        const textEl = elementsById.get(bound.id);
        if (textEl && textEl.text && textEl.text.trim().length > 0) {
          return textEl.text.trim();
        }
      }
    }
  }

  // Fallback: search any text element whose containerId is this shape's id
  for (const el of elementsById.values()) {
    if (el.type === 'text' && el.containerId === shape.id && el.text && el.text.trim().length > 0) {
      return el.text.trim();
    }
  }

  // Unlabeled shape
  return `unlabeled ${shape.type === 'rectangle' ? 'box' : shape.type}`;
}

/**
 * Serializes an array of Excalidraw elements into a compact text summary.
 * Returns empty string if no valid elements exist.
 */
export function serializeDiagram(elements: readonly ExcalidrawSimpleElement[]): string {
  if (!elements || elements.length === 0) {
    return '';
  }

  const activeElements = elements.filter(el => !el.isDeleted);
  if (activeElements.length === 0) {
    return '';
  }

  const elementsById = new Map<string, ExcalidrawSimpleElement>();
  for (const el of activeElements) {
    elementsById.set(el.id, el);
  }

  const shapes: string[] = [];
  const connections: string[] = [];
  const processedShapeIds = new Set<string>();

  // Collect shapes (rectangles, ellipses, diamonds, text-only notes, etc.)
  for (const el of activeElements) {
    if (el.type === 'arrow' || el.type === 'line') {
      continue;
    }

    // Skip standalone bound-text elements that are just labels of containers
    if (el.type === 'text' && el.containerId && elementsById.has(el.containerId)) {
      continue;
    }

    const label = getShapeLabel(el, elementsById);
    shapes.push(`- ${label} (${el.type})`);
    processedShapeIds.add(el.id);
  }

  // Collect arrows / connections
  for (const el of activeElements) {
    if (el.type === 'arrow' || el.type === 'line') {
      const startEl = el.startBinding ? elementsById.get(el.startBinding.elementId) : null;
      const endEl = el.endBinding ? elementsById.get(el.endBinding.elementId) : null;

      const startLabel = startEl ? getShapeLabel(startEl, elementsById) : 'unconnected start';
      const endLabel = endEl ? getShapeLabel(endEl, elementsById) : 'unconnected end';

      // Arrow might have its own bound text label
      const arrowLabel = getShapeLabel(el, elementsById);
      const isArrowLabeled = arrowLabel && !arrowLabel.startsWith('unlabeled');

      if (isArrowLabeled) {
        connections.push(`- ${startLabel} -> ${endLabel} (${arrowLabel})`);
      } else {
        connections.push(`- ${startLabel} -> ${endLabel}`);
      }
    }
  }

  if (shapes.length === 0 && connections.length === 0) {
    return '';
  }

  const sections: string[] = [];
  if (shapes.length > 0) {
    sections.push(`Shapes (${shapes.length}):\n${shapes.join('\n')}`);
  }
  if (connections.length > 0) {
    sections.push(`Connections (${connections.length}):\n${connections.join('\n')}`);
  }

  return sections.join('\n\n');
}
