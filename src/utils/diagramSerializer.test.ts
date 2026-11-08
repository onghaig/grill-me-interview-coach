import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeDiagram, getShapeLabel, ExcalidrawSimpleElement } from './diagramSerializer';

test('serializeDiagram returns empty string for empty elements', () => {
  assert.equal(serializeDiagram([]), '');
  assert.equal(serializeDiagram([{ id: '1', type: 'rectangle', isDeleted: true }]), '');
});

test('serializeDiagram correctly handles unlabeled shapes', () => {
  const elements: ExcalidrawSimpleElement[] = [
    { id: 'box1', type: 'rectangle' },
    { id: 'el1', type: 'ellipse' },
  ];
  const output = serializeDiagram(elements);
  assert.match(output, /unlabeled box \(rectangle\)/);
  assert.match(output, /unlabeled ellipse \(ellipse\)/);
});

test('serializeDiagram resolves bound text labels on shapes', () => {
  const elements: ExcalidrawSimpleElement[] = [
    {
      id: 'box1',
      type: 'rectangle',
      boundElements: [{ id: 'text1', type: 'text' }],
    },
    {
      id: 'text1',
      type: 'text',
      text: 'API Gateway',
      containerId: 'box1',
    },
    {
      id: 'box2',
      type: 'rectangle',
    },
    {
      id: 'text2',
      type: 'text',
      text: 'Redis Cache',
      containerId: 'box2',
    },
  ];

  const output = serializeDiagram(elements);
  assert.match(output, /API Gateway \(rectangle\)/);
  assert.match(output, /Redis Cache \(rectangle\)/);
  // Ensure standalone text element is not duplicated in shapes
  assert.equal((output.match(/Redis Cache/g) || []).length, 1);
});

test('serializeDiagram resolves connections between bound shapes', () => {
  const elements: ExcalidrawSimpleElement[] = [
    {
      id: 'b1',
      type: 'rectangle',
    },
    {
      id: 't1',
      type: 'text',
      text: 'Client App',
      containerId: 'b1',
    },
    {
      id: 'b2',
      type: 'rectangle',
    },
    {
      id: 't2',
      type: 'text',
      text: 'Load Balancer',
      containerId: 'b2',
    },
    {
      id: 'arr1',
      type: 'arrow',
      startBinding: { elementId: 'b1' },
      endBinding: { elementId: 'b2' },
      boundElements: [{ id: 't3', type: 'text' }],
    },
    {
      id: 't3',
      type: 'text',
      text: 'HTTPS / JSON',
      containerId: 'arr1',
    },
  ];

  const output = serializeDiagram(elements);
  assert.match(output, /Client App \(rectangle\)/);
  assert.match(output, /Load Balancer \(rectangle\)/);
  assert.match(output, /Client App -> Load Balancer \(HTTPS \/ JSON\)/);
});

test('serializeDiagram handles arrow with unlabeled shapes', () => {
  const elements: ExcalidrawSimpleElement[] = [
    { id: 'b1', type: 'rectangle' },
    { id: 'b2', type: 'ellipse' },
    {
      id: 'arr1',
      type: 'arrow',
      startBinding: { elementId: 'b1' },
      endBinding: { elementId: 'b2' },
    },
  ];

  const output = serializeDiagram(elements);
  assert.match(output, /unlabeled box -> unlabeled ellipse/);
});
