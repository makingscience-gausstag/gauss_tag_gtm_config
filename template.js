const copyFromWindow = require('copyFromWindow');
const setInWindow = require('setInWindow');
const callInWindow = require('callInWindow');
const createQueue = require('createQueue');
const getContainerVersion = require('getContainerVersion');

const injectScript = require('injectScript');
const queryPermission = require('queryPermission');
const log = require('logToConsole');
const Object = require('Object');
const getTimestampMillis = require('getTimestampMillis');
const localStorage = require('localStorage');
const JSON = require('JSON');


const KEY_STATE = 'gp_state';
if (!queryPermission('access_local_storage', 'read', KEY_STATE)) {
   log('GAUSS: ERROR: Cannot read localStorage. Review permissions for ' + KEY_STATE);
   data.gtmOnFailure();
   return;
}
if (!queryPermission('access_local_storage', 'write', KEY_STATE)) {
   log('GAUSS: ERROR: Cannot read localStorage. Review permissions for ' + KEY_STATE);
   data.gtmOnFailure();
   return;
}
var params_mode = 'default';

if (queryPermission('get_url', 'query', '_gp_mode_')) {
   const getUrl = require('getUrl');
   const url = getUrl('href');
   const parseUrl = require('parseUrl');
   const parsedUrl = parseUrl(url);
   if (parsedUrl.searchParams['_gp_mode_']) {
      params_mode = parsedUrl.searchParams['_gp_mode_'];
   }
   
}


const cv = getContainerVersion();
var doLog = cv.debugMode || cv.previewMode || params_mode == 'debug';

if (doLog) {
   log('_gp_mode_ =', params_mode);
   log('data =', data);
}

/*******************************************
Function definitions
*******************************************/

/* Custom class to allow storing initialization state */
var diagnostic = {
   reset: function () {
      localStorage.setItem(KEY_STATE, JSON.stringify({ "state": null, "states": [], "lastErrors": [] }));
   },
   updateState: function (state) {
      var st = localStorage.getItem(KEY_STATE);
      if (!st) {
         st = { 'state': state, states: [{ "state": state, "time": getTimestampMillis() }], "lastErrors": [] };
      } else {
         st = JSON.parse(st);
         st.state = state;
         st.states.push({ "state": state, "time": getTimestampMillis() });
      }
      localStorage.setItem('gp_state', JSON.stringify(st));
   },
   addError: function (error) {
      var st = localStorage.getItem(KEY_STATE);
      if (!st) {
         st = { "lastErrors": [] };
      } else {
         st = JSON.parse(st);
      }
      st.lastErrors.push(error);
      localStorage.setItem(KEY_STATE, JSON.stringify(st));
   },
   get: function () {
      var st = localStorage.getItem(KEY_STATE);
      if (!st) {
         st = { "state": null, "states": [], "lastErrors": [] };
      } else {
         st = JSON.parse(st);
      }
      return st;
   }
};
diagnostic.reset();
diagnostic.updateState('tpl.init');

function getGpSend() {
   const gp_send = copyFromWindow('gp_send');
   if (gp_send) {
      return gp_send;
   }
   
   setInWindow('gp_send', function () {
      var gp = copyFromWindow('gp');
      log('Called gp_send with', arguments[0]);
      if (arguments[0] == 'diagnostic') {
         return diagnostic.get();
      } else if (typeof gp != 'undefined' && gp.hasOwnProperty(data.gpId)) {
         callInWindow('gp_send', arguments);
      } else {
         callInWindow('_gp_queue.push', arguments);
      }
   });
   
   createQueue('_gp_queue');
}

function unflattenObject(arr) {
   const regularObj = arr.reduce(function (acc, currentValue) {
      const key = currentValue.key;
      const value = currentValue.value;
      const keys = key.split('.');
      let currentObj = acc;
      
      for (let i = 0; i < keys.length - 1; i++) {
         const currentKey = keys[i];
         currentObj[currentKey] = currentObj[currentKey] || {};
         currentObj = currentObj[currentKey];
      }
      currentObj[keys[keys.length - 1]] = value;
      
      return acc;
   }, {});
   
   return regularObj;
}

function isArray(obj) {
   return typeof obj !== 'undefined' && obj !== null && obj.toString !== '[object Object]';
}

function updateObject(targetObject, obj) {
   Object.keys(obj).forEach(function (key) {
      if ('object' === typeof obj[key] && !isArray(obj[key]) && obj[key] !== null && targetObject[key] !== null) {
         updateObject(targetObject[key], obj[key]);
      }
      else {
         targetObject[key] = obj[key];
      }
   });
}

/******************************************
Gauss Tag insertion
******************************************/

const defaultPixelUrl = 'https://gsatag.makingscience.com/v1.3.2/gauss-sa-tag.min.js';

let pixelUrl = data.pixelUrl ? data.pixelUrl : defaultPixelUrl;

const gp_send = getGpSend();

/**
 * Function executed when the gauss pixel script is successfully injected.
 * Proceed with the gauss configuration 
 */
function onInjected() {
   log('Injected successfully');
   diagnostic.updateState('tpl.injected');
   configurePixel();
}

/**
 * Function executed when the gauss pixel script cannot be injected
 */
function onInjectionFailed() {
   if (doLog) {
      log('Gauss pixel script couldn\'t be injected');
   }
   diagnostic.addError({ "message": 'Gauss pixel script couldn\'t be injected' });
   data.gtmOnFailure();
}

/**
 * Function executed after injection. It interprets all template properties
 * and configures the Gauss Tag
 */
function configurePixel() {
   let properties = {
      enableManualMode: data.enableManualMode,
      sender: {
         requestUrl: data.trackingId
      },
      user: {
         provider: data.userProvider,
         getGAClientId: data.getGA,
      },
      dataLayer: {
         enabled: true,
         provider: "GTM"
      },
   };
   // Default values
   let gaussId = 'default';
   
   // Overwrite the propertes with extra properties
   if (data.extraProperties) {
      updateObject(properties, unflattenObject(data.extraProperties));
   }
   
   // If requestUrl does not start with https:// prepend it
   if (properties.sender.requestUrl.indexOf('https://') !== 0) {
      properties.sender.requestUrl = 'https://' + properties.sender.requestUrl;
   }
   // if requestUrl does not have path part
   if (properties.sender.requestUrl.lastIndexOf('/') === 7) {
      properties.sender.requestUrl += '/data';
   }

   // ga user
   if (data.gaObjectName || data.gaIdRetrievalOrder) {
      properties.user.ga = properties.user.ga ? properties.user.ga : {};
      if (data.gaObjectName) {
         properties.user.ga.objectName = data.gaObjectName;
      }
      if (data.gaIdRetrievalOrder) {
         properties.user.ga.idRetrievalOrder = data.gaIdRetrievalOrder.map((e) => e.gaIdRetrievalOrderMethod);
      }
   }

   // local user
   if (data.userLocalStorageType || data.userLocalStorageId || data.idLength) {
      properties.user.local = properties.user.local ? properties.user.local : {};
      if (data.userLocalStorageType) {
         properties.user.local.storageType = data.userLocalStorageType;
      }
      if (data.userLocalStorageId) {
         properties.user.local.storageId = data.userLocalStorageId;
      }
      if (data.userLocalIdLen) {
         properties.user.local.idLen = data.userLocalIdLen;
      }
   }

   // globalVar
   if (data.userGlobalPath) {
      properties.user.globalVar = properties.user.globalVar ? properties.user.globalVar : {};
      if (data.userGlobalPath) {
         properties.user.globalVar.path = data.userGlobalPath;
      }
   }

   // cookie
   if (data.userCookieName || data.userCookieExtractRegex || data.userCookieRegexCaptureIndex) {
      properties.user.cookie = properties.user.cookie ? properties.user.cookie : {};
      if (data.userCookieName) {
         properties.user.cookie.name = data.userCookieName;
      }
      if (data.userCookieExtractRegex) {
         properties.user.cookie.extractRegex = data.userCookieExtractRegex;
      }
      if (data.userCookieRegexCaptureIndex) {
         properties.user.cookie.captureIndex = data.userCookieRegexCaptureIndex;
      }
   }

   // check if dataLayerId is not set
   if (data.dataLayerId) {
      properties.dataLayer.dataLayerId = data.dataLayerId;
   }

   // check if messageFormat is not set
   if (data.messageFormat) {
      properties.sender.messageFormat = data.messageFormat;
   }

   // check if dataLayer exclusion regex is defined
   // append the default to avoid re-triggering of own events
   if (data.excludeRegex) {
      properties.dataLayer.exclude = data.excludeRegex + '|event": *"gtm|event": *"gauss|"0": *"';
   }

   // check if dataLayer inclusion regex is defined
   if (data.includeRegex) {
      properties.dataLayer.include = data.includeRegex;
   }

   // nully dataLayer.provider
   if (data.disableDataLayer) {
      properties.dataLayer.enabled = false;
   }

   // Check if id is set
   if (properties.id) {
      gaussId = properties.id;
   } else if (data.gpId) {
      gaussId = data.gpId;
      properties.id = gaussId;
   }

   // Set filtering options
   properties.filter = {};

   // Client trimming option
   if (data.clientTrimming && data.clientTrimming < 100) {
      properties.filter.trimming = data.clientTrimming;
   }

   // Url exclusion option
   if (data.urlExclude) {
      properties.filter.url_exclude = data.urlExclude;
   }

   // Url inclusion option
   if (data.urlInclude) {
      properties.filter.url_include = data.urlInclude;
   }

   // Datalayer tag generated pushes
   properties.push = {};
   if (data.thirdPartyCEnabled !== undefined) {
      properties.push.thirdPartyCEnabled = data.thirdPartyCEnabled;
   }
   log('Push config: ' + properties.push.thirdPartyCEnabled);
   if (doLog) {
      properties.logging = 'debug';
      log('Config properties:', properties);
   }

   properties.msgEnrichers = {};
   if (data.enricherGa4SessionId !== undefined) {
      properties.msgEnrichers.ga4sessionId = data.enricherGa4SessionId;
   }
   diagnostic.updateState('tpl.prepared');
   callInWindow('gp_send', 'config', gaussId, properties);
   diagnostic.updateState('tpl.configured');
   data.gtmOnSuccess();
}

if (queryPermission('inject_script', pixelUrl)) {
   if (doLog) {
      log('url', pixelUrl);
   }
   diagnostic.updateState('tpl.injecting');
   injectScript(pixelUrl, onInjected, onInjectionFailed, 'gp_send');
} else {
   if (doLog) {
      log('Gauss Tag: Script load failed due to permissions mismatch.');
   }
   diagnostic.addError({ "message": "No inject script permission" });
   data.gtmOnFailure();
}