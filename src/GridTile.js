import * as THREE from 'three';
import { hexPhaseTile } from './torusUtils.js';
import { gridNodes, rotate2d, constrainedDelaunay, euclidean2torus } from './torusUtils.js';

const HEX_SIDE = 1 / Math.sqrt(3);

/**
 * GridTile encapsulates the mesh elements for one hexagonal tile,
 * including face mesh, wireframe, and boundary edges. You can apply
 * any transform function that maps a toroidal [t1,t2] to [x,y,z],
 * and any color mapping function that maps [t1,t2] (and optionally index)
 * to [r,g,b].
 * 
 * Supports two constructor modes:
 * - Grid resolution (numRings) as a number to generate a standard tile.
 * - Legacy object form with torusCoords and baseGeom.
 */
export class GridTile {
  /**
   * @param {number|object} config
   *   If a number: interpreted as grid resolution (numRings).
   *   If an object: { torusCoords, baseGeom, position?, scale? } as before.
   */
  constructor(numRings, options = {}) {
    let torusCoords, baseGeom;
    // build Euclidean vertices for unit tile
    let Pv = gridNodes(numRings);
    Pv = Pv.map(([x, y]) => [ 
      x / (numRings) * HEX_SIDE,
      y / (numRings) * HEX_SIDE ]);
    Pv = rotate2d(Pv, Math.PI / 6);
    // triangulate without filtering

    const spacing = HEX_SIDE / (numRings);
    const tri = constrainedDelaunay(Pv, spacing);
    // build BufferGeometry
    const geom = new THREE.BufferGeometry();
    const verts = [];
    Pv.forEach(([x,y]) => verts.push(x, 0, y));
    geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    const indices = [];
    tri.forEach(([i,j,k]) => indices.push(i-1,j-1,k-1));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    // compute toroidal coords
    const Tv3 = euclidean2torus(Pv);
    this.torusCoords = Tv3.map(([t1,t2]) => [t1, t2]);
    this.scaleFactor    = options.scale    || (2 * Math.PI);
    this.positionOffset = options.position || [0, 0, 0];

    // Face geometry with color placeholder
    this.faceGeom = geom;
    this._initColorAttribute();

    // Face material & mesh
    this.faceMat  = new THREE.MeshPhongMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: true,
      vertexColors: true,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    this.faceMesh = new THREE.Mesh(this.faceGeom, this.faceMat);

    // Wireframe geometry & mesh (line segments from triangles)
    const faceIdx = this.faceGeom.index.array;
    const lineIndices = [];
    for (let i = 0; i < faceIdx.length; i += 3) {
      const a = faceIdx[i], b = faceIdx[i+1], c = faceIdx[i+2];
      lineIndices.push(a, b, b, c, c, a);
    }
    this.wireGeom = new THREE.BufferGeometry();
    this.wireGeom.setAttribute('position', this.faceGeom.getAttribute('position'));
    this.wireGeom.setIndex(lineIndices);
    this.wireMat  = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthTest: false
    });
    this.wireMesh = new THREE.LineSegments(this.wireGeom, this.wireMat);

    // Boundary edges (unit hexagon) -> updated in setTransform
    this.boundaryTP = hexPhaseTile();
    this.boundaryTP.push(this.boundaryTP[0]);
    this.edgeGeom   = new THREE.BufferGeometry();
    this.edgePos    = new Float32Array(this.boundaryTP.length * 3);
    this.edgeGeom.setAttribute('position', new THREE.Float32BufferAttribute(this.edgePos, 3));
    this.edgeMat    = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true
    });
    this.edgeMesh   = new THREE.Line(this.edgeGeom, this.edgeMat);

    // Group all parts
    this.group = new THREE.Group();
    this.group.add(this.faceMesh, this.wireMesh, this.edgeMesh);
    this.setPosition(this.positionOffset);
    this.setScale(this.scaleFactor);
    this.setOpacity(1);
  }

  // Initialize an empty color buffer
  _initColorAttribute() {
    const count = this.faceGeom.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    this.faceGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  /** Set world position of this tile group */
  setPosition([x, y, z]) {
    this.group.position.set(x, y, z);
  }

  /** Set uniform scale of this tile group */
  setScale(s) {
    this.group.scale.set(s, s, s);
  }

  /** Show or hide all parts */
  setVisibility(visible) {
    this.faceMesh.visible = visible;
    this.wireMesh.visible = visible;
    this.edgeMesh.visible = visible; // DEBUG: disable this for now
  }

  /** Set opacity on all materials */
  setOpacity(alpha) {
    this.faceMat.opacity = alpha;
    this.wireMat.opacity = alpha*0.1;
    this.edgeMat.opacity = alpha;
  }

  /**
   * Applies a transform function to update vertex positions.
   * @param {function([number,number]):[number,number,number]} fn
   */
  setTransform(fn) {
    const posAttr = this.faceGeom.getAttribute('position');
    const n = posAttr.count;
    for (let i = 0; i < n; i++) {
      const [t1, t2]   = this.torusCoords[i];
      const [x, y, z]  = fn([t1, t2]);
      posAttr.setXYZ(i, x, y, z);
    }
    posAttr.needsUpdate = true;
    this.faceGeom.computeVertexNormals();

    // Update boundary edges
    for (let i = 0; i < this.boundaryTP.length; i++) {
      const [bt1, bt2] = this.boundaryTP[i];
      const [ex, ey, ez] = fn([bt1, bt2]);
      this.edgePos[3*i  ] = ex;
      this.edgePos[3*i+1] = ey;
      this.edgePos[3*i+2] = ez;
    }
    this.edgeGeom.attributes.position.needsUpdate = true;
  }

  /**
   * Applies a color mapping function to update vertex colors.
   * @param {function([number,number], number): [number,number,number]} fn
   */
  setColorMap(fn) {
    const colorAttr = this.faceGeom.getAttribute('color');
    const n = colorAttr.count;
    for (let i = 0; i < n; i++) {
      const [r, g, b] = fn(this.torusCoords[i], i);
      colorAttr.setXYZ(i, r, g, b);
    }
    colorAttr.needsUpdate = true;
  }

  /**
   * Create a new GridTile sharing geometry and torusCoords.
   */
  clone(deepCopy = false) {
    const c = Object.create(GridTile.prototype);

    // share coords and geom
    c.torusCoords = this.torusCoords;
    c.faceGeom    = this.faceGeom;
    c.wireGeom    = this.wireGeom;
    c.edgeGeom    = this.edgeGeom;
    if (deepCopy) {
      c.faceGeom = c.faceGeom.clone();
      c.wireGeom = c.wireGeom.clone();
      c.edgeGeom = c.edgeGeom.clone();
    }

    // share boundary coordinates and edge positions
    c.boundaryTP = this.boundaryTP;
    c.edgePos    = this.edgePos;

    // clone materials
    c.faceMat     = this.faceMat.clone();
    c.wireMat     = this.wireMat.clone();
    c.edgeMat     = this.edgeMat.clone();

    // meshes
    c.faceMesh    = new THREE.Mesh(c.faceGeom, c.faceMat);
    c.wireMesh    = new THREE.LineSegments(c.wireGeom, c.wireMat);
    c.edgeMesh    = new THREE.Line(c.edgeGeom, c.edgeMat);

    // group
    c.group       = new THREE.Group();
    c.group.add(c.faceMesh, c.wireMesh, c.edgeMesh);
    
    // copy transforms
    c.scaleFactor    = this.scaleFactor;
    c.positionOffset = [...this.positionOffset];
    c.setScale(c.scaleFactor);
    c.setPosition(c.positionOffset);
    c.setOpacity(c.opacity);

    return c;
  }

  /**
   * Create a grid of cloned tiles at centers from gridNodes(numRings).
   * @param {GridTile}  template    A tile to clone.
   * @param {number}    numRings    Number of rings for tiling.
   */
  static tile(template, numRings) {
    const centers = gridNodes(numRings);
    return centers.map(([cx, cy]) => {
      const t = template.clone();
      t.setPosition([cx * template.scaleFactor, 0, cy * template.scaleFactor]);
      return t;
    });
  }
}
