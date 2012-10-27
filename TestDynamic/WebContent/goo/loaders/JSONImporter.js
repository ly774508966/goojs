define(['goo/entities/components/TransformComponent', 'goo/renderer/MeshData', 'goo/loaders/JsonUtils',
		'goo/entities/components/MeshDataComponent', 'goo/entities/components/MeshRendererComponent',
		'goo/renderer/Material', 'goo/renderer/TextureCreator', 'goo/renderer/Shader'], function(TransformComponent,
	MeshData, JsonUtils, MeshDataComponent, MeshRendererComponent, Material, TextureCreator, Shader) {
	"use strict";

	/**
	 * Creates a new importer
	 * 
	 * @name JSONImporter
	 * @class Importer for our compressed JSON format
	 * @param {World} world {@link World} reference needed to create entities
	 */
	function JSONImporter(world) {
		this.world = world;

		this.materials = {};
		// this.skeletonMap = Maps.newHashMap();
		// this.poseMap = Maps.newHashMap();
		this.slotUnitMap = {
			diffuse : 0,
			normal : 1,
			ao : 2,
			occlusion : 3,
			specular : 3
		};

		this.loadedEntities = [];

		this.baseTextureDir = '';
	}

	/**
	 * Loads a model from the supplied model url and texture path.
	 * 
	 * @param modelUrl
	 * @param textureDir
	 * @param callback Callback with
	 *            <ul>
	 *            <li>onSuccess(entities)
	 *            <li>onError(error)
	 *            </ul>
	 * @returns Entities created during load
	 */
	JSONImporter.prototype.load = function(modelUrl, textureDir, callback) {
		var request = new XMLHttpRequest();
		request.open('GET', modelUrl, true);
		var that = this;
		request.onreadystatechange = function() {
			if (request.readyState === 4) {
				if (request.status >= 200 && request.status <= 299) {
					var entities = that.parse(request.responseText, textureDir);
					callback.onSuccess(entities);
				} else {
					callback.onError(request.statusText);
				}
			}
		};
		request.send();
	};

	/**
	 * Parses a model from the supplied model source and texture path.
	 * 
	 * @param {String} modelSource JSON model source as a string
	 * @param textureDir Texture path
	 * @returns Entities created during load
	 */
	JSONImporter.prototype.parse = function(modelSource, textureDir) {
		this.baseTextureDir = textureDir || '';
		this.loadedEntities = [];

		var root = JSON.parse(modelSource);

		// check if we're compressed or not
		this.useCompression = root.UseCompression || false;

		if (this.useCompression) {
			this.compressedVertsRange = root.CompressedVertsRange || (1 << 14) - 1; // int
			this.compressedColorsRange = root.CompressedColorsRange || (1 << 8) - 1; // int
			this.compressedUnitVectorRange = root.CompressedUnitVectorRange || (1 << 10) - 1; // int
		}

		// pull in materials
		this._parseMaterials(root.Materials);

		// pull in skeletons if we have any
		// if (root.Skeletons")) {
		// parseSkeletons(root.get("Skeletons").isArray(), resource);
		// }

		// pull in skeleton poses if we have any
		// if (root.SkeletonPoses")) {
		// parseSkeletonPoses(root.get("SkeletonPoses").isArray(),
		// resource);
		// }

		// parse scene
		this._parseSpatial(root.Scene);

		return this.loadedEntities;
	};

	JSONImporter.prototype._parseSpatial = function(object) {
		var type = object.Type;
		var name = object.Name === null ? "null" : object.Name;

		var entity = this.world.createEntity();
		entity.setComponent(new TransformComponent());
		entity.name = name;
		this.loadedEntities.push(entity);

		if (type === "Node") {
			if (object.Children) {
				for ( var i in object.Children) {
					var child = object.Children[i];
					var childEntity = this._parseSpatial(child);
					if (childEntity !== null) {
						entity.transformComponent.attachChild(childEntity.transformComponent);
					}
				}
			}
		} else if (type === "Mesh") {
			var meshRendererComponent = new MeshRendererComponent();

			var material = Material.defaultLitMaterial; // Material.defaultMaterial;
			meshRendererComponent.materials.push(material);
			entity.setComponent(meshRendererComponent);

			this._parseMaterial(object, entity);

			var meshData = this._parseMeshData(object.MeshData, 0, entity, type);
			if (meshData === null) {
				return null;
			}

			entity.setComponent(new MeshDataComponent(meshData));
		} else if (type === "SkinnedMesh") {
			var meshRendererComponent = new MeshRendererComponent();
			meshRendererComponent.materials.push(Material.defaultMaterial);
			entity.setComponent(meshRendererComponent);

			this._parseMaterial(object, entity);

			var meshData = this._parseMeshData(object.MeshData, 4, entity, type);
			if (meshData === null) {
				return null;
			}

			entity.setComponent(new MeshDataComponent(meshData));

			// if (object.Pose")) {
			// final String ref =
			// object.get("Pose").isString().stringValue();
			// mesh.setCurrentPose(resource.poseMap.get(ref));
			// }
		} else {
			return;
		}

		var transform = JsonUtils.parseTransform(object.Transform);
		entity.transformComponent.transform = transform;

		return entity;
	};

	JSONImporter.prototype._parseMeshData = function(object, weightsPerVert, entity, type) {
		var vertexCount = object.VertexCount; // int
		if (vertexCount === 0) {
			return null;
		}
		var indexCount = object.IndexLengths ? object.IndexLengths[0] : 0;

		var attributeMap = {};
		if (object.Vertices) {
			attributeMap.POSITION = MeshData.createAttribute(3, 'Float');
		}
		if (object.Normals) {
			attributeMap.NORMAL = MeshData.createAttribute(3, 'Float');
		}
		if (object.Tangents) {
			attributeMap.TANGENT = MeshData.createAttribute(3, 'Float');
		}
		if (object.Colors) {
			attributeMap.COLOR = MeshData.createAttribute(4, 'Float');
		}
		if (weightsPerVert > 0 && object.Weights) {
			attributeMap.WEIGHTS = MeshData.createAttribute(4, 'Float');
		}
		if (weightsPerVert > 0 && object.Joints) {
			attributeMap.JOINTIDS = MeshData.createAttribute(4, 'Short');
		}
		if (object.TextureCoords) {
			for (i in object.TextureCoords) {
				attributeMap['TEXCOORD' + i] = MeshData.createAttribute(2, 'Float');
			}
		}

		var meshData = new MeshData(attributeMap, vertexCount, indexCount);

		if (object.Vertices) {
			if (this.useCompression) {
				var offsetObj = object.VertexOffsets;
				JsonUtils.fillAttributeBufferFromCompressedString(object.Vertices, meshData, MeshData.POSITION, [
						object.VertexScale, object.VertexScale, object.VertexScale], [offsetObj.xOffset,
						offsetObj.yOffset, offsetObj.zOffset]);
			} else {
				JsonUtils.fillAttributeBuffer(object.Vertices, meshData, MeshData.POSITION);
			}
		}
		if (object.Weights) {
			if (this.useCompression) {
				var offset = 0;
				var scale = 1 / this.compressedVertsRange;

				JsonUtils.fillAttributeBufferFromCompressedString(object.Weights, meshData, MeshData.WEIGHTS, [scale],
					[offset]);
			} else {
				JsonUtils.fillAttributeBuffer(object.Weights, meshData, MeshData.WEIGHTS);
			}
		}
		if (object.Normals) {
			if (this.useCompression) {
				var offset = 1 - (this.compressedUnitVectorRange + 1 >> 1);
				var scale = 1 / -offset;

				JsonUtils.fillAttributeBufferFromCompressedString(object.Normals, meshData, MeshData.NORMAL, [scale,
						scale, scale], [offset, offset, offset]);
			} else {
				JsonUtils.fillAttributeBuffer(object.Normals, meshData, MeshData.NORMAL);
			}
		}
		if (object.Tangents) {
			if (this.useCompression) {
				var offset = 1 - (this.compressedUnitVectorRange + 1 >> 1);
				var scale = 1 / -offset;

				JsonUtils.fillAttributeBufferFromCompressedString(object.Tangents, meshData, MeshData.TANGENT, [scale,
						scale, scale, scale], [offset, offset, offset, offset]);
			} else {
				JsonUtils.fillAttributeBuffer(object.Tangents, meshData, MeshData.TANGENT);
			}
		}
		if (object.Colors) {
			if (this.useCompression) {
				var offset = 0;
				var scale = 255 / (this.compressedColorsRange + 1);
				JsonUtils.fillAttributeBufferFromCompressedString(object.Colors, meshData, MeshData.COLOR, [scale,
						scale, scale, scale], [offset, offset, offset, offset]);
			} else {
				JsonUtils.fillAttributeBuffer(object.Colors, meshData, MeshData.COLOR);
			}
		}
		if (object.TextureCoords) {
			var textureUnits = object.TextureCoords;
			if (this.useCompression) {
				for ( var i = 0; i < textureUnits.length; i++) {
					var texObj = textureUnits[i];
					JsonUtils.fillAttributeBufferFromCompressedString(texObj.UVs, meshData, 'TEXCOORD' + i,
						texObj.UVScales, texObj.UVOffsets);
				}
			} else {
				for ( var i = 0; i < textureUnits.length; i++) {
					JsonUtils.fillAttributeBuffer(textureUnits[i], meshData, 'TEXCOORD' + i);
				}
			}
		}
		if (object.Joints) {
			var buffer = meshData.getAttributeBuffer(MeshData.JOINTIDS);
			var data;
			if (this.useCompression) {
				data = JsonUtils.getIntBufferFromCompressedString(object.Joints, 32767);
			} else {
				data = JsonUtils.getIntBuffer(object.Joints, 32767);
			}

			if (type === 'SkinnedMesh') {
				// map these joints to local.
				var localJointMap = {};
				var localIndex = 0;
				for ( var i = 0, max = data.length; i < max; i++) {
					var jointIndex = data[i];
					if (localJointMap[jointIndex] === undefined) {
						localJointMap[jointIndex] = localIndex++;
					}

					buffer.set([localJointMap[jointIndex]], i);
				}

				// store local map
				var localMap = [];
				for ( var jointIndex in localJointMap) {
					localIndex = localJointMap[jointIndex];
					localMap[localIndex] = jointIndex;
				}
				// ((SkinnedMesh) mesh).setPaletteMap(localMap);
			} else {
				for ( var i = 0, max = data.capacity(); i < max; i++) {
					buffer.putCast(i, data.get(i));
				}
			}
		}

		if (object.Indices) {
			if (this.useCompression) {
				meshData.getIndexBuffer().set(JsonUtils.getIntBufferFromCompressedString(object.Indices, vertexCount));
			} else {
				meshData.getIndexBuffer().set(JsonUtils.getIntBuffer(object.Indices, vertexCount));
			}
		}

		if (object.IndexModes) {
			var modes = object.IndexModes;
			if (modes.length === 1) {
				meshData.indexModes[0] = modes[0];
			} else {
				var modeArray = [];
				for ( var i = 0; i < modes.length; i++) {
					modeArray[i] = modes[i];
				}
				meshData.indexModes = modeArray;
			}
		}

		if (object.IndexLengths) {
			var lengths = object.IndexLengths;
			var lengthArray = [];
			for ( var i = 0; i < lengths.length; i++) {
				lengthArray[i] = lengths[i];
			}
			meshData.indexLengths = lengthArray;
		}

		return meshData;
	};

	JSONImporter.prototype._parseMaterials = function(array) {
		if (array === null) {
			return;
		}

		for ( var i = 0, max = array.length; i < max; i++) {
			var obj = array[i];
			if (obj === null) {
				continue;
			}

			var info = new MaterialInfo();

			// name is required
			info.materialName = obj.MaterialName;
			info.profile = obj.Profile;
			info.technique = obj.Technique;
			info.usesTransparency = obj.UsesTransparency;
			info.materialState = this._parseMaterialstate(obj);

			if (obj.TextureEntries) {
				var entries = obj.TextureEntries;
				for ( var j = 0, maxEntry = entries.length; j < maxEntry; j++) {
					var entry = entries[j];

					var textureSlot = entry.Slot;
					var textureReference = entry.TextureReference || null;
					var fileName = entry.TextureSource || null;
					var minificationFilterStr = entry.MinificationFilter || null;
					var minificationFilter = 'Trilinear';
					if (minificationFilterStr !== null) {
						try {
							minificationFilter = 'minificationFilterStr';
						} catch (e) {
							console.warning("Bad texture minification filter: " + minificationFilterStr);
						}
					}
					var flipTexture = entry.Flip !== undefined ? entry.Flip : true;

					info.textureReferences[textureSlot] = textureReference;
					info.textureFileNames[textureSlot] = fileName;
					info.textureMinificationFilters[textureSlot] = minificationFilter;
					info.textureFlipSettings[textureSlot] = flipTexture;
				}
			}
			this.materials[info.materialName] = info;
		}
	};

	JSONImporter.prototype._parseMaterial = function(object, entity) {
		// look for material
		if (object.Material) {
			var info = this.materials[object.Material];
			if (info !== undefined) {
				// TODO
				var material = new Material(info.materialName);
				material.shader = entity.meshRendererComponent.materials[0].shader;
				entity.meshRendererComponent.materials[0] = material;

				// info.connectedMeshes.push(mesh);

				// apply material state
				material.materialState = info.materialState;

				if (info.useTransparency) {
					// TODO
					// var bs = new BlendState();
					// bs.setBlendEnabled(true);
					// bs.setSourceFunction(SourceFunction.SourceAlpha);
					// bs.setDestinationFunction(DestinationFunction.OneMinusSourceAlpha);
					// // bs.setConstantColor(new ColorRGBA(0.5f, 0.5f,
					// 0.5f,
					// // 0.5f));
					// mesh.setRenderState(bs);
					// mesh.getSceneHints().setRenderBucketType(RenderBucketType.Transparent);
				}

				// apply textures
				var foundTextures = false;
				for ( var key in this.slotUnitMap) {
					if (info.textureFileNames[key] !== undefined) {
						var baseTexFileName = info.textureFileNames[key];
						foundTextures = true;
						var minificationFilter = info.textureMinificationFilters[key];
						var flipTexture = info.textureFlipSettings[key];

						var tex;
						if (this.nameResolver !== undefined) {
							tex = new TextureCreator().withMinificationFilter(minificationFilter).withVerticalFlip(
								flipTexture).withGooResourceCache(_useCache).makeTexture2D(
								nameResolver.resolveName(baseTexFileName));
						} else {
							// look for pak contents
							// var rsrc =
							// GooResourceManager.getImageResource(_useCache,
							// baseTexFileName);
							// if (rsrc !== null) {
							// tex = new
							// TextureCreator().withMinificationFilter(minificationFilter).withVerticalFlip(
							// flipTexture).withGooResourceCache(_useCache).makeTexture2D(baseTexFileName);
							// } else {

							tex = new TextureCreator().loadTexture2D(this.baseTextureDir + baseTexFileName);

							// tex = new
							// TextureCreator().withMinificationFilter(minificationFilter).withVerticalFlip(
							// flipTexture).withGooResourceCache(_useCache).makeTexture2D(
							// _baseTextureDir + baseTexFileName);
							// }
						}

						// TODO: Get wrap from json instead
						// tex.setWrap(WrapMode.Repeat);
						material.textures[this.slotUnitMap[key]] = tex;
					}
				}
				if (foundTextures) {
					// mesh.setRenderState(ts);
				}
			}
		}
	};

	JSONImporter.prototype._parseMaterialstate = function(object) {
		var ms = {};

		ms.ambient = this._parseColor(object.AmbientColor);
		ms.diffuse = this._parseColor(object.DiffuseColor);
		ms.emissive = this._parseColor(object.EmissiveColor);
		ms.specular = this._parseColor(object.SpecularColor);
		ms.shininess = object.Shininess;

		return ms;
	};

	JSONImporter.prototype._parseColor = function(hex) {
		var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})*$/i.exec(hex);
		return result ? {
			r : parseInt(result[1], 16) / 255.0,
			g : parseInt(result[2], 16) / 255.0,
			b : parseInt(result[3], 16) / 255.0,
			a : result[4] !== undefined ? parseInt(result[4], 16) / 255.0 : 1.0
		} : null;
	};

	// TODO
	function MaterialInfo() {
		// REVIEW: Unused expressions!?
		this.materialName = 'not set';
		this.profile;
		this.technique;
		this.textureReferences = {};
		this.textureFileNames = {};
		this.textureMinificationFilters = {};
		this.textureFlipSettings = {};
		this.usesTransparency = false;
		this.materialState = {};
		this.connectedMeshes = [];
	}

	return JSONImporter;
});