import * as THREE from 'three';
import { hexPhaseTile } from './torusUtils.js';

const HEX_SIDE = 1 / Math.sqrt(3);

/**
 * GridTile encapsulates the mesh elements for one hexagonal tile,
 * including face mesh, wireframe, and boundary edges. You can apply
 * any transform function that maps a toroidal [t1,t2] to [x,y,z],
 * and any color mapping function that maps [t1,t2] (and optionally index)
 * to [r,g,b].
 */
export class GridTile {
  /**
   * @param {Array<[number,number]>} torusCoords  Array of [t1,t2] per vertex.
   * @param {THREE.BufferGeometry}    baseGeom     Unit-tile geometry.
   * @param {object}                  options      { position: [x,y,z], scale: number }
   */
  constructor(torusCoords, baseGeom, options = {}) {
    this.torusCoords    = torusCoords;
    this.scaleFactor    = options.scale    || (2 * Math.PI);
    this.positionOffset = options.position || [0, 0, 0];

    // Face geometry with color placeholder
    this.faceGeom = baseGeom.clone();
    this._initColorAttribute();

    // Face material & mesh
    this.faceMat  = new THREE.MeshPhongMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    });
    this.faceMesh = new THREE.Mesh(this.faceGeom, this.faceMat);

    // Wireframe geometry & mesh
    this.wireGeom = new THREE.BufferGeometry();
    this.wireGeom.setAttribute('position', this.faceGeom.getAttribute('position'));
    this.wireGeom.setIndex(this.faceGeom.index);
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
    this.edgeMesh.visible = visible;
  }

  /** Set opacity on all materials */
  setOpacity(alpha) {
    this.faceMat.opacity = alpha;
    this.wireMat.opacity = alpha;
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
      const [t1, t2] = this.torusCoords[i];
      const [r, g, b] = fn([t1, t2], i);
      colorAttr.setXYZ(i, r, g, b);
    }
    colorAttr.needsUpdate = true;
  }
}
