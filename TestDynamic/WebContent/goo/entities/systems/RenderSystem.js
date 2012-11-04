define(['goo/entities/systems/System', 'goo/renderer/TextureCreator', 'goo/renderer/Util', 'goo/entities/EventHandler'], function(System,
	TextureCreator, Util, EventHandler) {
	"use strict";

	function RenderSystem(renderList) {
		System.call(this, 'RenderSystem', null, true);

		this.renderList = renderList;

		var that = this;
		EventHandler.addListener({
			setCurrentCamera : function(camera) {
				that.camera = camera;
			}
		});
	}

	RenderSystem.prototype = Object.create(System.prototype);

	RenderSystem.prototype.render = function(renderer) {
		renderer.checkResize(this.camera);

		renderer.clear();

		for ( var i in this.renderList) {
			this.renderEntity(renderer, this.renderList[i]);
		}

		renderer.flush();
	};

	RenderSystem.prototype.renderEntity = function(renderer, entity) {
		var renderInfo = {
			meshData : entity.meshDataComponent.meshData,
			materials : entity.meshRendererComponent.materials,
			transform : entity.transformComponent.worldTransform,
			camera : this.camera,
			lights : entity._world.getManager('LightManager').lights
		};

		renderer.render(renderInfo);
	};

	return RenderSystem;
});