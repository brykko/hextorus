import * as THREE from 'three';
import { hexPhaseTile, buildRhombusMeshGrid} from './torusUtils.js';
import { gridNodes, rotate2d, constrainedDelaunay, euclidean2torus } from './torusUtils.js';

const HEX_SIDE = 1 / Math.sqrt(3);

/*
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
  constructor(nGrid, options = {}) {
    /* 
    * Suggested change:
    *
    * If using the 'hexagon' tile shape, we build the final coordinate grid
    * using gridNodes(), which returns the ready-made hexagon tile. We
    * then derive the toroidal coords from the Euclidean coords.
    * 
    * If using the 'rhombus' tile shape, we instead *begin* by creating a
    * (square) grid of toroidal coords first, and then transform it to
    * generate the rhombus tile coords.
    */

    this.shape = options.shape || 'hexagon';
    this.seamType = options.seamType || 'overlapping'; // 'exact' or 'overlapping'
    let Pv;
    let spacing;
    let tri;
    let scaleFactor;

    // Two options exist for defining the tile edges (via option 'seamType')
    //    'exact': tile edges meet precisely without gaps or overlap
    //    'overlapping': tile is extended by 1/2 spacing, so that borders overlap
    //
    // The latter is useful when tessellating tiles, because the amount of overlap
    // ensures that the border width remains the same when tiles are placed side
    // by side. 
    console.log('this.seamType = ', this.seamType);
    if (this.seamType === 'overlapping'){
      console.log('Overlapping seams...');
      scaleFactor = 1 + (1/nGrid);
      // const a = 1.2;
      // Pv = Pv.map(([x, y]) => [x*a, y*a]);
    } else {
      scaleFactor = 1;
    }

    if (this.shape === 'hexagon') {
    // build Euclidean vertices for unit tile
      nGrid = Math.ceil(nGrid / 2); 
      Pv = gridNodes(nGrid);

      // scale into world units
      Pv = Pv.map(([x, y]) => [
        (x / nGrid) * HEX_SIDE * scaleFactor,
        (y / nGrid) * HEX_SIDE * scaleFactor
      ]);

        // default hexagon: rotate to point-up
      Pv = rotate2d(Pv, Math.PI/6);
      const Tv3 = euclidean2torus(Pv);
      this.torusCoords = Tv3.map(([t1,t2]) => [t1, t2]);
      spacing = scaleFactor * HEX_SIDE / (nGrid);
    } else if (this.shape === 'rhombus') {
      // Generate rhombus meshgrid in phase and Euclidean coords
      let { phaseCoords, euclidCoords } = buildRhombusMeshGrid(nGrid);

      this.torusCoords = phaseCoords.map(([t1, t2]) => [
        t1 * scaleFactor,
        t2 * scaleFactor
      ]);
      
      Pv = euclidCoords.map(([x, y]) => [
        x * scaleFactor,
        y * scaleFactor
      ]);

      spacing = scaleFactor / nGrid;
    }

    tri = constrainedDelaunay(Pv, spacing);

    // Store base euclidean coords before any transform applied
    this.euclidCoords = Pv;

    // build BufferGeometry
    const geom = new THREE.BufferGeometry();
    const verts = [];
    Pv.forEach(([x,y]) => verts.push(x, 0, y));
    geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    const indices = [];
    tri.forEach(([i, j, k]) => {
      // Convert 1-based Delaunay output to 0-based indices
      indices.push(i - 1, j - 1, k - 1);
    });
    geom.setIndex(indices);
    geom.computeVertexNormals();
    // Initialize shared color buffer on faceGeom
    this.faceGeom = geom;
    this._initColorAttribute();

    // Split triangles into interior vs border based on border-vertex membership
    const faceIdx = geom.index.array;
    // Count edge occurrences
    const edgeCount = new Map();
    for (let i = 0; i < faceIdx.length; i += 3) {
      const a = faceIdx[i], b = faceIdx[i+1], c = faceIdx[i+2];
      [[a,b],[b,c],[c,a]].forEach(([u,v]) => {
        const key = u < v ? `${u}_${v}` : `${v}_${u}`;
        edgeCount.set(key, (edgeCount.get(key)||0) + 1);
      });
    }
    // Find border vertices (vertices on any edge that occurs only once)
    const borderVerts = new Set();
    edgeCount.forEach((count, key) => {
      if (count === 1) {
        const [u,v] = key.split('_').map(Number);
        borderVerts.add(u);
        borderVerts.add(v);
      }
    });
    // Partition triangles
    const interiorIdx = [], borderIdx = [];
    for (let i = 0; i < faceIdx.length; i += 3) {
      const a = faceIdx[i], b = faceIdx[i+1], c = faceIdx[i+2];
      if (borderVerts.has(a) || borderVerts.has(b) || borderVerts.has(c)) {
        borderIdx.push(a, b, c);
      }
      interiorIdx.push(a, b, c);
    }
    // Build separate geometries
    this.interiorGeom = new THREE.BufferGeometry();
    this.interiorGeom.setAttribute('position', geom.getAttribute('position'));
    this.interiorGeom.setAttribute('color',    geom.getAttribute('color'));
    this.interiorGeom.setIndex(interiorIdx);
    this.interiorGeom.computeVertexNormals();

    this.borderGeom = new THREE.BufferGeometry();
    this.borderGeom.setAttribute('position', geom.getAttribute('position'));
    this.borderGeom.setAttribute('color',    geom.getAttribute('color'));
    this.borderGeom.setIndex(borderIdx);
    this.borderGeom.computeVertexNormals();

    this.scaleFactor    = options.scale    || (2 * Math.PI);
    this.positionOffset = options.position || [0, 0, 0];

    // Material for data‐colored triangles
    this.faceMat = new THREE.MeshPhongMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: true,
      vertexColors: true
    });
    // Interior and border meshes
    this.interiorMesh = new THREE.Mesh(this.interiorGeom, this.faceMat);
    this.borderMat    = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false
    });
    this.borderMesh   = new THREE.Mesh(this.borderGeom, this.borderMat);

    // Wireframe geometry & mesh (line segments from triangles)
    const faceIdx2 = this.faceGeom.index.array;
    const lineIndices = [];
    for (let i = 0; i < faceIdx2.length; i += 3) {
      const a = faceIdx2[i], b = faceIdx2[i+1], c = faceIdx2[i+2];
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

    // Points mesh: render each vertex as a colored point
    this.pointsGeom = new THREE.BufferGeometry();
    // share positions and colors with the face geometry
    this.pointsGeom.setAttribute('position', this.faceGeom.getAttribute('position'));
    this.pointsGeom.setAttribute('color',    this.faceGeom.getAttribute('color'));
    this.pointsMat = new THREE.PointsMaterial({
      size: options.pointSize || 6,    // adjust as needed
      sizeAttenuation: false,          // screen‐space points
      vertexColors: true,              // use per-vertex color buffer
      transparent: true,
      depthTest: true,
      depthWrite: false
    });
    this.pointsMesh = new THREE.Points(this.pointsGeom, this.pointsMat);
    this.pointsMesh.renderOrder = 1;

    // Group all parts
    this.group = new THREE.Group();
    this.group.add(this.interiorMesh, this.borderMesh, this.wireMesh, this.pointsMesh);
    this.setPosition(this.positionOffset);
    this.setScale(this.scaleFactor);

    this.showFaces = true;
    this.showWireframe = true;
    this.showPoints = false;
    this.showTileEdges = true;

    this.setOpacity(1);
    this.setVisibility(true);

  }

  // Initialize an empty color buffer
  _initColorAttribute() {
    const count = this.faceGeom.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    this.faceGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    // TODO: initialize pointsGeom colors here too. If possible, we want pointsGeom
    // and faceGeom to share the same underlying color data.
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
    this.interiorMesh.visible  = visible && this.showFaces;
    this.borderMesh.visible    = visible && this.showTileEdges;
    this.wireMesh.visible      = visible && this.showWireframe;
    this.pointsMesh.visible    = visible && this.showPoints;
    // this.edgeMesh.visible = visible && this.showTileEdges; // DEBUG: disable this for now
    this.visible = visible;
  }

  /** Set opacity on all materials */
  setOpacity(alpha) {
    this.faceMat.opacity = alpha;
    this.borderMat.opacity = alpha;
    this.wireMat.opacity = alpha*0.1;
    this.pointsMat.opacity = alpha;
    // this.edgeMat.opacity = alpha;
    this.opacity = alpha;
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

    // // Update boundary edges
    // for (let i = 0; i < this.boundaryTP.length; i++) {
    //   const [bt1, bt2] = this.boundaryTP[i];
    //   const [ex, ey, ez] = fn([bt1, bt2]);
    //   this.edgePos[3*i  ] = ex;
    //   this.edgePos[3*i+1] = ey;
    //   this.edgePos[3*i+2] = ez;
    // }
    // this.edgeGeom.attributes.position.needsUpdate = true;
  }

  /**
   * Applies a color mapping function to update vertex colors.
   * 
   * The supplied function must take the torus coordinates and 
   * index of a vertex, and return the corresponding [r, g, b] 
   * values.
   * 
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
    c.euclidCoords = this.euclidCoords;
    c.faceGeom    = this.faceGeom;
    c.wireGeom    = this.wireGeom;
    c.edgeGeom    = this.edgeGeom;
    c.pointsGeom  = this.pointsGeom;
    c.interiorGeom = this.interiorGeom;
    c.borderGeom = this.borderGeom;
    if (deepCopy) {
      // Copying the geometry duplicates the underlying data
      // (which often we may not want)
      c.faceGeom = c.faceGeom.clone();
      c.wireGeom = c.wireGeom.clone();
      c.edgeGeom = c.edgeGeom.clone();
      c.pointsGeom = c.pointsGeom.clone();
      c.interiorGeom = c.interiorGeom.clone();
      c.borderGeom = c.borderGeom.clone();
    }

    // share boundary coordinates and edge positions
    // c.boundaryTP = this.boundaryTP;
    c.edgePos    = this.edgePos;

    // clone materials
    c.faceMat     = this.faceMat.clone();
    c.wireMat     = this.wireMat.clone();
    c.pointsMat   = this.pointsMat.clone();
    c.borderMat   = this.borderMat.clone();
    // c.edgeMat     = this.edgeMat.clone();

    // meshes
    c.interiorMesh = new THREE.Mesh(c.interiorGeom, c.faceMat);
    c.borderMesh   = new THREE.Mesh(c.borderGeom, c.borderMat);
    c.faceMesh    = null;
    c.wireMesh    = new THREE.LineSegments(c.wireGeom, c.wireMat);
    c.pointsMesh  = new THREE.Points(c.pointsGeom, c.pointsMat);
    // c.edgeMesh    = new THREE.Line(c.edgeGeom, c.edgeMat);

    // group
    c.group       = new THREE.Group();
    c.group.add(c.interiorMesh, c.borderMesh, c.wireMesh, c.pointsMesh);
    
    // copy transforms
    c.scaleFactor    = this.scaleFactor;
    c.positionOffset = [...this.positionOffset];
    c.setScale(c.scaleFactor);
    c.setPosition(c.positionOffset);
    c.setOpacity(this.opacity);
    c.setVisibility(this.visible);

    // graphical state
    c.showFaces = this.showFaces;
    c.showWireframe = this.showWireframe;
    c.showPoints = this.showPoints;
    c.showTileEdges = this.showTileEdges;

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
