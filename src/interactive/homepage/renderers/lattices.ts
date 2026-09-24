export type LatticeKind = 'square' | 'honeycomb' | 'hexagonal' | 'kagome' | 'penrose';

export interface LatticeGraph {
  kind: LatticeKind;
  x: Float32Array;
  y: Float32Array;
  offsets: Uint32Array;
  neighbors: Uint32Array;
  edges: Uint32Array;
  nodeCount: number;
  edgeCount: number;
}

interface Point { x: number; y: number; }
interface Triangle { type: 0 | 1; a: Point; b: Point; c: Point; }

const MAX_NODES = 4800;
const MAX_EDGES = 11000;

class GraphBuilder {
  points: Point[] = [];
  edges: Array<[number, number]> = [];
  private pointIndex = new Map<string, number>();
  private edgeKeys = new Set<string>();

  addPoint(x: number, y: number) {
    const key = `${Math.round(x * 20)}:${Math.round(y * 20)}`;
    const existing = this.pointIndex.get(key);
    if (existing !== undefined) return existing;
    const index = this.points.length;
    this.points.push({ x, y });
    this.pointIndex.set(key, index);
    return index;
  }

  addEdge(a: number, b: number) {
    if (a === b) return;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = `${lo}:${hi}`;
    if (this.edgeKeys.has(key)) return;
    this.edgeKeys.add(key);
    this.edges.push([lo, hi]);
  }
}

function finalise(kind: LatticeKind, builder: GraphBuilder): LatticeGraph {
  const nodeCount = builder.points.length;
  const degree = new Uint32Array(nodeCount);
  for (const [a, b] of builder.edges) {
    degree[a]++;
    degree[b]++;
  }

  const offsets = new Uint32Array(nodeCount + 1);
  for (let i = 0; i < nodeCount; i++) offsets[i + 1] = offsets[i] + degree[i];

  const neighbors = new Uint32Array(offsets[nodeCount]);
  const cursor = offsets.slice(0, nodeCount);
  const edges = new Uint32Array(builder.edges.length * 2);

  builder.edges.forEach(([a, b], edgeIndex) => {
    neighbors[cursor[a]++] = b;
    neighbors[cursor[b]++] = a;
    edges[edgeIndex * 2] = a;
    edges[edgeIndex * 2 + 1] = b;
  });

  const x = new Float32Array(nodeCount);
  const y = new Float32Array(nodeCount);
  builder.points.forEach((point, i) => {
    x[i] = point.x;
    y[i] = point.y;
  });

  return {
    kind,
    x,
    y,
    offsets,
    neighbors,
    edges,
    nodeCount,
    edgeCount: builder.edges.length,
  };
}

function square(width: number, height: number, spacing: number) {
  const builder = new GraphBuilder();
  const margin = spacing * 2;
  const columns = Math.ceil((width + margin * 2) / spacing) + 1;
  const rows = Math.ceil((height + margin * 2) / spacing) + 1;
  const ids = new Int32Array(columns * rows);

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      ids[row * columns + column] = builder.addPoint(
        column * spacing - margin,
        row * spacing - margin,
      );
    }
  }

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const id = ids[row * columns + column];
      if (column + 1 < columns) builder.addEdge(id, ids[row * columns + column + 1]);
      if (row + 1 < rows) builder.addEdge(id, ids[(row + 1) * columns + column]);
    }
  }
  return finalise('square', builder);
}

function triangular(width: number, height: number, spacing: number) {
  const builder = new GraphBuilder();
  const margin = spacing * 2;
  const rowHeight = spacing * Math.sqrt(3) * 0.5;
  const rows = Math.ceil((height + margin * 2) / rowHeight) + 1;
  const columns = Math.ceil((width + margin * 2) / spacing) + 2;
  const ids = new Int32Array(rows * columns);

  for (let row = 0; row < rows; row++) {
    const shift = (row & 1) * spacing * 0.5;
    for (let column = 0; column < columns; column++) {
      ids[row * columns + column] = builder.addPoint(
        column * spacing + shift - margin,
        row * rowHeight - margin,
      );
    }
  }

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const id = ids[row * columns + column];
      if (column + 1 < columns) builder.addEdge(id, ids[row * columns + column + 1]);
      if (row + 1 < rows) {
        builder.addEdge(id, ids[(row + 1) * columns + column]);
        const diagonal = (row & 1) ? column + 1 : column - 1;
        if (diagonal >= 0 && diagonal < columns) {
          builder.addEdge(id, ids[(row + 1) * columns + diagonal]);
        }
      }
    }
  }
  return finalise('hexagonal', builder);
}

function honeycombBuilder(width: number, height: number, edgeLength: number) {
  const builder = new GraphBuilder();
  const margin = edgeLength * 4;
  const dx = Math.sqrt(3) * edgeLength;
  const dy = 1.5 * edgeLength;
  const rows = Math.ceil((height + margin * 2) / dy) + 2;
  const columns = Math.ceil((width + margin * 2) / dx) + 2;

  for (let row = -1; row < rows; row++) {
    const shift = (row & 1) ? dx * 0.5 : 0;
    for (let column = -1; column < columns; column++) {
      const cx = column * dx + shift - margin;
      const cy = row * dy - margin;
      const vertices = new Int32Array(6);
      for (let k = 0; k < 6; k++) {
        const theta = Math.PI / 6 + k * Math.PI / 3;
        vertices[k] = builder.addPoint(
          cx + Math.cos(theta) * edgeLength,
          cy + Math.sin(theta) * edgeLength,
        );
      }
      for (let k = 0; k < 6; k++) builder.addEdge(vertices[k], vertices[(k + 1) % 6]);
    }
  }
  return builder;
}

function honeycomb(width: number, height: number, edgeLength: number) {
  return finalise('honeycomb', honeycombBuilder(width, height, edgeLength));
}

function kagome(width: number, height: number, edgeLength: number) {
  const honey = honeycombBuilder(width, height, edgeLength * 1.34);
  const builder = new GraphBuilder();
  const edgeNode = new Int32Array(honey.edges.length);

  honey.edges.forEach(([a, b], edgeIndex) => {
    const pa = honey.points[a];
    const pb = honey.points[b];
    edgeNode[edgeIndex] = builder.addPoint((pa.x + pb.x) * 0.5, (pa.y + pb.y) * 0.5);
  });

  const incident: number[][] = Array.from({ length: honey.points.length }, () => []);
  honey.edges.forEach(([a, b], edgeIndex) => {
    incident[a].push(edgeIndex);
    incident[b].push(edgeIndex);
  });

  for (const edgeIds of incident) {
    for (let i = 0; i < edgeIds.length; i++) {
      for (let j = i + 1; j < edgeIds.length; j++) {
        builder.addEdge(edgeNode[edgeIds[i]], edgeNode[edgeIds[j]]);
      }
    }
  }
  return finalise('kagome', builder);
}

function pointOnSegment(a: Point, b: Point, fraction: number): Point {
  return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
}

function penrose(width: number, height: number, lowCapability: boolean, depthOverride?: number) {
  const phi = (1 + Math.sqrt(5)) * 0.5;
  let triangles: Triangle[] = [];
  const radius = Math.max(width, height) * 0.82;
  const cx = width * 0.5;
  const cy = height * 0.52;

  for (let i = 0; i < 10; i++) {
    const bAngle = (2 * i - 1) * Math.PI / 10;
    const cAngle = (2 * i + 1) * Math.PI / 10;
    let b = { x: cx + Math.cos(bAngle) * radius, y: cy + Math.sin(bAngle) * radius };
    let c = { x: cx + Math.cos(cAngle) * radius, y: cy + Math.sin(cAngle) * radius };
    if ((i & 1) === 0) [b, c] = [c, b];
    triangles.push({ type: 0, a: { x: cx, y: cy }, b, c });
  }

  const depth = depthOverride ?? (lowCapability ? 5 : 6);
  for (let generation = 0; generation < depth; generation++) {
    const next: Triangle[] = [];
    for (const triangle of triangles) {
      const { a, b, c } = triangle;
      if (triangle.type === 0) {
        const p = pointOnSegment(a, b, 1 / phi);
        next.push(
          { type: 0, a: c, b: p, c: b },
          { type: 1, a: p, b: c, c: a },
        );
      } else {
        const q = pointOnSegment(b, a, 1 / phi);
        const r = pointOnSegment(b, c, 1 / phi);
        next.push(
          { type: 1, a: r, b: c, c: a },
          { type: 1, a: q, b: r, c: b },
          { type: 0, a: r, b: q, c: a },
        );
      }
    }
    triangles = next;
  }

  const builder = new GraphBuilder();
  const crop = Math.max(width, height) * 0.14;
  const inCrop = (point: Point) =>
    point.x >= -crop && point.x <= width + crop && point.y >= -crop && point.y <= height + crop;

  // Robinson triangles are halves of Penrose rhombs. Following the standard
  // construction, draw C-A-B and omit the B-C base so paired triangles form
  // the rhomb edge graph rather than adding diagonals.
  for (const triangle of triangles) {
    const { a, b, c } = triangle;
    if (!(inCrop(a) || inCrop(b) || inCrop(c))) continue;
    const ia = builder.addPoint(a.x, a.y);
    const ib = builder.addPoint(b.x, b.y);
    const ic = builder.addPoint(c.x, c.y);
    builder.addEdge(ic, ia);
    builder.addEdge(ia, ib);
  }

  return finalise('penrose', builder);
}

export function createLatticeGraph(
  kind: LatticeKind,
  width: number,
  height: number,
  lowCapability: boolean,
): LatticeGraph {
  if (kind === 'penrose') {
    let depth = lowCapability ? 5 : 6;
    let graph = penrose(width, height, lowCapability, depth);
    while ((graph.nodeCount > MAX_NODES || graph.edgeCount > MAX_EDGES) && depth > 3) {
      depth--;
      graph = penrose(width, height, lowCapability, depth);
    }
    return graph;
  }

  let spacing = lowCapability ? 34 : 28;
  let graph: LatticeGraph;
  for (let attempt = 0; attempt < 7; attempt++) {
    switch (kind) {
      case 'square':
        graph = square(width, height, spacing);
        break;
      case 'honeycomb':
        graph = honeycomb(width, height, spacing * 0.62);
        break;
      case 'hexagonal':
        // Configuration name "hexagonal" denotes the degree-6 triangular
        // lattice (six nearest neighbours), not the degree-3 honeycomb graph.
        graph = triangular(width, height, spacing);
        break;
      case 'kagome':
        // Kagome is constructed above as the line graph of the honeycomb:
        // honeycomb-edge midpoints become nodes and incident edges connect.
        graph = kagome(width, height, spacing * 0.64);
        break;
    }
    if (graph.nodeCount <= MAX_NODES && graph.edgeCount <= MAX_EDGES) return graph;
    spacing *= 1.18;
  }
  return graph!;
}
