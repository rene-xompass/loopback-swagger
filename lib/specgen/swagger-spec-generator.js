// Copyright IBM Corp. 2015,2019. All Rights Reserved.
// Node module: loopback-swagger
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';

// Globalization
var g = require('strong-globalize')();

/**
 * Module dependencies.
 */
var path = require('path');
var _ = require('lodash');
var routeHelper = require('./route-helper');
var modelHelper = require('./model-helper');
var typeConverter = require('./type-converter');
var tagBuilder = require('./tag-builder');
var TypeRegistry = require('./type-registry');

/**
 * Create Swagger Object describing the API provided by loopbackApplication.
 *
 * @param {Application} loopbackApplication The application to document.
 * @param {Object} opts Options.
 * @returns {Object}
 */
module.exports = function createSwaggerObject(loopbackApplication, opts) {
  opts = _.defaults(opts || {}, {
    basePath: loopbackApplication.get('restApiRoot') || '/api',
    // Default consumes/produces
    consumes: [
      'application/json'
    ],
    produces: [
      'application/json'
    ],
    securitySchemes: {
      accessToken: {
        type: 'apiKey',
        in: 'header',
        name: 'authorization'
      },
      accessTokenParam: {
        type: 'apiKey',
        in: 'query',
        name: 'access_token'
      }
    },
    version: getPackagePropertyOrDefault('version', '1.0.0')
  });

  // We need a temporary REST adapter to discover our available routes.
  var remotes = loopbackApplication.remotes();
  var adapter = remotes.handler('rest').adapter;
  var routes = adapter.allRoutes();
  var classes = remotes.classes();

  // Generate fixed fields like info and basePath
  var swaggerObject = generateSwaggerObjectBase(opts, loopbackApplication);

  var typeRegistry = new TypeRegistry();
  var operationIdRegistry = Object.create(null);
  var loopbackRegistry = loopbackApplication.registry ||
    loopbackApplication.loopback.registry ||
    loopbackApplication.loopback;
  var models = loopbackRegistry.modelBuilder.models;
  for (var modelName in models) {
    modelHelper.registerModelDefinition(models[modelName], typeRegistry, opts);
  }

  // A class is an endpoint root; e.g. /users, /products, and so on.
  // In Swagger 2.0 and OAS 3, there is no endpoint roots, but one can group endpoints
  // using tags.
  const tags = [];
  classes.forEach(function (aClass) {
    if (!aClass.name) return;

    var hasDocumentedMethods = aClass.methods().some(function (m) {
      return m.documented;
    });
    if (!hasDocumentedMethods) return;

    // swaggerObject.tags.push(tagBuilder.buildTagFromClass(aClass));
    tags.push(tagBuilder.buildTagFromClass(aClass));
  });

  let paths = {};
  // A route is an endpoint, such as /users/findOne.
  routes.forEach(function (route) {
    if (!route.documented) return;

    // Get the class definition matching this route.
    let [className, methodName] = /^([^.]+)\.(.*)$/.exec(route.method).slice(1);
    methodName = methodName.replace('prototype.', '');

    let classDef = classes.filter(function (item) {
      return item.name === className;
    })[0];

    if (!classDef) {
      g.error('Route exists with no class: %j', route);
      return;
    }

    // Filter methods if _swaggerMethods is defined
    const _swaggerMethods = classDef._swaggerMethods;
    if (_swaggerMethods && !_swaggerMethods[methodName]) {
      return;
    }

    routeHelper.addRouteToSwaggerPaths(route, classDef,
      typeRegistry, operationIdRegistry,
      paths, opts);
  });

  const schemas = typeRegistry.getSchemas();
  const sortedSchema = {};
  Object.keys(schemas).sort().forEach(current => {
    sortedSchema[current] = schemas[current];
  });
  _.assign(swaggerObject.components.schemas, sortedSchema);

  const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
  const usedTags = {};
  Object.keys(paths).sort().forEach(current => {
    swaggerObject.paths[current] = {};
    methods.forEach(method => {
      const def = paths[current][method];
      swaggerObject.paths[current][method] = def;

      if (def) {
        def.tags.forEach(tag => {
          usedTags[tag] = true;
        });
      }
    });
  });

  // filter unused tags
  swaggerObject.tags = tags.filter(tag => usedTags[tag.name]).sort((a, b) => a.name > b.name ? 1 : -1);

  loopbackApplication.emit('swaggerResources', swaggerObject);
  return swaggerObject;
};

/**
 * Generate a top-level resource doc. This is the entry point for swagger UI
 * and lists all of the available APIs.
 * @param  {Object} opts Swagger options.
 * @return {Object}      Resource doc.
 */
function generateSwaggerObjectBase(opts, loopbackApplication) {
  var swaggerSpecExtensions = loopbackApplication.get('swagger');
  var apiInfo = _.cloneDeep(opts.apiInfo) || {};
  for (var propertyName in apiInfo) {
    var property = apiInfo[propertyName];
    apiInfo[propertyName] = typeConverter.convertText(property);
  }
  apiInfo.version = String(apiInfo.version || opts.version);
  if (!apiInfo.title) {
    apiInfo.title = getPackagePropertyOrDefault('name', 'LoopBack Application');
  }

  if (!apiInfo.description) {
    apiInfo.description = getPackagePropertyOrDefault(
      'description',
      'LoopBack Application'
    );
  }

  var basePath = opts.basePath;
  if (basePath && /\/$/.test(basePath))
    basePath = basePath.slice(0, -1);

  let security = undefined;
  if (opts.securitySchemes) {
    security = [];
    for (let type in opts.securitySchemes) {
      const def = {};
      def[type] = [];
      security.push(def);
    }
  }

  return _.defaults({
    openapi: '3.0.1',
    info: apiInfo,
    servers: [{url: basePath}],
    paths: {},
    tags: [],
    components: {
      schemas: {},
      securitySchemes: opts.securitySchemes
    },
    security: security
  }, swaggerSpecExtensions || {}, {
    host: opts.host

    // TODO Authorizations (security, securityDefinitions)
    // TODO: responses, externalDocs
  });
}

function getPackagePropertyOrDefault(name, defautValue) {
  try {
    var pkg = require(path.join(process.cwd(), 'package.json'));
    return pkg[name] || defautValue;
  } catch (e) {
    return defautValue;
  }
}
