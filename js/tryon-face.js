import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.180.0/three.module.min.js';
import { getCameraStreamProxy, stopCameraStreamProxy, attachStreamToVideoProxy } from './camera-utils.js';

export const CONFIG = {
    LANDMARKS: {
        LEFT_EAR: 0,
        CHIN_CENTER: 7,
        RIGHT_EAR: 14,
        LEFT_EYE: 27,
        RIGHT_EYE: 32,
        NOSE_TIP: 33,
        NOSE_BRIDGE: 41
    },
    DETECTION: {
        REFERENCE_FACE_WIDTH: 180,
        MIN_DISTANCE_SCALE: 0.5,
        MAX_DISTANCE_SCALE: 1.5,
        AVERAGE_FACE_WIDTH_CM: 14,
        AVERAGE_EYE_DISTANCE_CM: 6.3
    },
    GLASSES: {
        WIDTH_TO_FACE_RATIO: 0.55,
        WIDTH_TO_EYE_RATIO: 1.25,
        BRIDGE_WEIGHT: 0.5,
        DEPTH_TO_WIDTH_RATIO: 1.0,
        ROTATION_DAMPENING: 0.8
    },
    SCENE: {
        CAMERA_FOV: 45,
        LIGHT_FRONT_INTENSITY: 0.6,
        LIGHT_SIDE_INTENSITY: 0.7,
        LIGHT_FRONT_Z: 1000,
        LIGHT_SIDE_X: 1000
    }
};

export class TryOnFace {
    constructor(params) {
        this.selector = 'tryon';
        this.object = params.object;
        this.width = params.width;
        this.height = params.height;
        this.statusHandler = params.statusHandler || function(){};
        this.changeStatus('STATUS_READY');
        this.video = document.getElementById('camera');
        document.getElementById(this.selector).style.width = this.width + "px";
        this.video.setAttribute('width', this.width);
        this.video.setAttribute('height', this.height);
        this.stream = null;
        this.position = { x: 0, y: 0, z: 0 };
        this.rotation = { x: 0, y: 0 };
        this.size = { x: 1, y: 1, z: 1 };
        this.faceMesh = null;
        this.camera = null;
        this.init3D();
    }

    changeStatus(status) {
        this.status = status;
        this.statusHandler(this.status);
    }

    start() {
        this.changeStatus('STATUS_SEARCH');
        this.initFaceMesh();
    }

    stop() {
        if (this.camera) {
            this.camera.stop();
            this.camera = null;
        }
        this.changeStatus('STATUS_READY');
    }

    initFaceMesh() {
        this.faceMesh = new window.FaceMesh({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
        });
        this.faceMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });
        this.faceMesh.onResults(this.onResults.bind(this));
        this.camera = new window.Camera(this.video, {
            onFrame: async () => {
                await this.faceMesh.send({image: this.video});
            },
            width: this.width,
            height: this.height
        });
        this.camera.start();
    }

    onResults(results) {
        if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
            this.changeStatus('STATUS_SEARCH');
            this.size.x = 0;
            this.size.y = 0;
            this.render();
            return;
        }
        this.changeStatus('STATUS_FOUND');
        const landmarks = results.multiFaceLandmarks[0];
        // Use MediaPipe landmark indices for left/right ear, eyes, nose, etc.
        // See: https://github.com/tensorflow/tfjs-models/blob/master/face-landmarks-detection/mesh_map.jpg
        // Example indices:
        // Left ear: 234, Right ear: 454, Left eye: 33, Right eye: 263, Nose tip: 1, Nose bridge: 168
        const L = {
            LEFT_EAR: 234,
            RIGHT_EAR: 454,
            LEFT_EYE: 33,
            RIGHT_EYE: 263,
            NOSE_TIP: 1,
            NOSE_BRIDGE: 168
        };
        function getXY(idx) {
            return [landmarks[idx].x * this.width, landmarks[idx].y * this.height];
        }
        const positions = {};
        Object.keys(L).forEach(key => {
            positions[L[key]] = getXY.call(this, L[key]);
        });
        // Calculate parameters using MediaPipe landmarks
        const faceWidth = Math.abs(positions[L.RIGHT_EAR][0] - positions[L.LEFT_EAR][0]);
        const distanceScale = CONFIG.DETECTION.REFERENCE_FACE_WIDTH / faceWidth;
        const faceCenterX = (positions[L.LEFT_EAR][0] + positions[L.RIGHT_EAR][0]) / 2;
        const noseX = positions[L.NOSE_TIP][0];
        const horizontalOffset = noseX - faceCenterX;
        const normalizedOffset = horizontalOffset / (faceWidth / 2);
        const maxRotationRad = Math.PI / 4;
        const yawAngleRad = normalizedOffset * maxRotationRad;
        const leftEyeX = positions[L.LEFT_EYE][0];
        const leftEyeY = positions[L.LEFT_EYE][1];
        const rightEyeX = positions[L.RIGHT_EYE][0];
        const rightEyeY = positions[L.RIGHT_EYE][1];
        const eyeDeltaX = rightEyeX - leftEyeX;
        const eyeDeltaY = rightEyeY - leftEyeY;
        const rollAngleRad = Math.atan2(-eyeDeltaY, eyeDeltaX);
        const centerX = positions[L.NOSE_TIP][0];
        const weight = CONFIG.GLASSES.BRIDGE_WEIGHT;
        const centerY = positions[L.NOSE_BRIDGE][1] * weight + positions[L.NOSE_TIP][1] * (1 - weight);
        const center = this.correct(centerX, centerY);
        const eyeDistance = rightEyeX - leftEyeX;
        const widthByFace = faceWidth * CONFIG.GLASSES.WIDTH_TO_FACE_RATIO;
        const widthByEyes = eyeDistance * CONFIG.GLASSES.WIDTH_TO_EYE_RATIO;
        const glassesWidth = (!isFinite(eyeDistance) || eyeDistance < 8)
            ? widthByFace
            : widthByEyes * 0.65 + widthByFace * 0.35;
        let frontWidth = 100, frontHeight = 50;
        if (this.textures && this.textures['front'] && this.textures['front'].image) {
            frontWidth = this.textures['front'].image.width;
            frontHeight = this.textures['front'].image.height;
        }
        this.position.x = center.x;
        this.position.y = center.y;
        this.rotation.y = yawAngleRad * CONFIG.GLASSES.ROTATION_DAMPENING;
        this.rotation.z = rollAngleRad * CONFIG.GLASSES.ROTATION_DAMPENING;
        this.size.x = glassesWidth;
        this.size.y = (this.size.x / frontWidth) * frontHeight;
        this.size.z = this.size.x * CONFIG.GLASSES.DEPTH_TO_WIDTH_RATIO;
        const absYaw = Math.min(Math.abs(yawAngleRad), maxRotationRad) / maxRotationRad;
        const depthDampen = 1 - (absYaw * 0.6);
        this.position.z = - (this.size.z / 2) * depthDampen;
        this.render();
    }

    loop() {
        window.requestAnimFrame(this.loop.bind(this));
        const positions = this.tracker.getCurrentPosition();

        if (positions) {
            const L = CONFIG.LANDMARKS;
            const distanceScale = this.calculateDistanceScale(positions);
            const yawAngleRad = this.calculateYawAngle(positions);
            const rollAngleRad = this.calculateRollAngle(positions);
            const centerPixels = this.calculateGlassesCenter(positions);
            const center = this.correct(centerPixels.x, centerPixels.y);
            const glassesWidth = this.calculateGlassesWidth(positions);
            let frontWidth = 100, frontHeight = 50; // Fallback values

            if (this.textures['front'] && this.textures['front'].image) {
                frontWidth = this.textures['front'].image.width;
                frontHeight = this.textures['front'].image.height;
            }

            if (distanceScale < CONFIG.DETECTION.MAX_DISTANCE_SCALE && distanceScale > CONFIG.DETECTION.MIN_DISTANCE_SCALE) {
                this.changeStatus('STATUS_FOUND');
                this.position.x = center.x;
                this.position.y = center.y;
                this.rotation.y = yawAngleRad * CONFIG.GLASSES.ROTATION_DAMPENING;
                this.rotation.z = rollAngleRad * CONFIG.GLASSES.ROTATION_DAMPENING;
                this.size.x = glassesWidth;
                this.size.y = (this.size.x / frontWidth) * frontHeight;
                this.size.z = this.size.x * CONFIG.GLASSES.DEPTH_TO_WIDTH_RATIO;
                const maxYaw = Math.PI / 4;
                const absYaw = Math.min(Math.abs(yawAngleRad), maxYaw) / maxYaw;
                const depthDampen = 1 - (absYaw * 0.6);
                this.position.z = - (this.size.z / 2) * depthDampen;
            } else {
                this.changeStatus('STATUS_SEARCH');
                this.size.x = 0;
                this.size.y = 0;
            }

            this.render();
        }
    }

    correct(x, y) {
        return {
            x: (x - this.width / 2) / 2,
            y: (this.height / 2 - y) / 2
        };
    }

    async loadTextures(textureLoader, renderer, sources) {
        const keys = Object.keys(sources);
        const textures = {};
        const promises = keys.map(key => {
            return new Promise(resolve => {
                textureLoader.load(
                    sources[key],
                    texture => {
                        texture.minFilter = THREE.LinearFilter;
                        texture.magFilter = THREE.LinearFilter;
                        texture.anisotropy = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;
                        texture.encoding = THREE.sRGBEncoding;
                        textures[key] = texture;
                        resolve();
                    },
                    undefined,
                    () => {
                        textures[key] = null;
                        resolve();
                    }
                );
            });
        });
        await Promise.all(promises);
        return textures;
    }

    createMaterials(textures) {
        return [
            textures.left
                ? new THREE.MeshLambertMaterial({ map: textures.left, transparent: true, opacity: 1 })
                : new THREE.MeshLambertMaterial({ color: 0x00ff00, opacity: 1 }),
            textures.right
                ? new THREE.MeshLambertMaterial({ map: textures.right, transparent: true, opacity: 1 })
                : new THREE.MeshLambertMaterial({ color: 0xff0000, opacity: 1 }),
            new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0 }),
            new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0 }),
            textures.front
                ? new THREE.MeshLambertMaterial({ map: textures.front, transparent: true, opacity: 1 })
                : new THREE.MeshLambertMaterial({ color: 0x0000ff, opacity: 1 }),
            new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0 })
        ];
    }

    createScene(renderer, materials) {
        const scene = new THREE.Scene();
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const cube = new THREE.Mesh(geometry, materials);
        scene.add(cube);
        const camera = new THREE.PerspectiveCamera(CONFIG.SCENE.CAMERA_FOV, this.width / this.height, 1, 5000);
        camera.lookAt(cube.position);
        camera.position.z = this.width / 2;
        scene.add(camera);
        scene.add(new THREE.AmbientLight(0xffffff, 1.0));
        const lightFront = new THREE.PointLight(0xffffff, CONFIG.SCENE.LIGHT_FRONT_INTENSITY);
        lightFront.position.set(0, 0, CONFIG.SCENE.LIGHT_FRONT_Z);
        scene.add(lightFront);
        const lightLeft = new THREE.PointLight(0xffffff, CONFIG.SCENE.LIGHT_SIDE_INTENSITY);
        lightLeft.position.set(CONFIG.SCENE.LIGHT_SIDE_X, 0, 0);
        scene.add(lightLeft);
        const lightRight = new THREE.PointLight(0xffffff, CONFIG.SCENE.LIGHT_SIDE_INTENSITY);
        lightRight.position.set(-CONFIG.SCENE.LIGHT_SIDE_X, 0, 0);
        scene.add(lightRight);
        return { scene, camera, cube };
    }

    async init3D() {
        const canvas = document.getElementById("overlay");
        const renderer = new THREE.WebGLRenderer({
            canvas: canvas,
            antialias: true,
            alpha: true
        });
        renderer.setClearColor(0xffffff, 0);
        renderer.setSize(this.width, this.height);
        const textureLoader = new THREE.TextureLoader();
        const sources = {
            left: this.object.outside.left,
            right: this.object.outside.right,
            front: this.object.outside.front
        };
        this.textures = await this.loadTextures(textureLoader, renderer, sources);
        const materials = this.createMaterials(this.textures);
        const { scene, camera, cube } = this.createScene(renderer, materials);
        this.render = () => {
            cube.position.x = this.position.x;
            cube.position.y = this.position.y;
            cube.position.z = this.position.z;
            cube.rotation.y = this.rotation.y;
            cube.rotation.z = this.rotation.z;
            cube.scale.x = this.size.x;
            cube.scale.y = this.size.y;
            cube.scale.z = this.size.z;
            renderer.render(scene, camera);
        };
    }

    getStatus() {
        return this.status;
    }

    getParameters() {
        return {
            position: { ...this.position },
            rotation: { ...this.rotation },
            size: { ...this.size }
        };
    }
}
