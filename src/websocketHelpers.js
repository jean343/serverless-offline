const { DateTime } = require('luxon');
const { createUniqueId } = require('./utils');

// TODO this should be probably moved to utils, and combined with other header
// functions and utilities
function createMultiValueHeaders(headers) {
  return Object.entries(headers).reduce((acc, [key, value]) => {
    acc[key] = [value];

    return acc;
  }, {});
}

// CLF -> Common Log Format
// https://httpd.apache.org/docs/1.3/logs.html#common
// [day/month/year:hour:minute:second zone]
// day = 2*digit
// month = 3*letter
// year = 4*digit
// hour = 2*digit
// minute = 2*digit
// second = 2*digit
// zone = (`+' | `-') 4*digit
function formatToClfTime(date) {
  return DateTime.fromJSDate(date).toFormat('dd/MMM/yyyy:HH:mm:ss ZZZ');
}

const createRequestContext = (action, eventType, connection) => {
  const now = new Date();

  let requestContext = {
    apiId: 'private',
    domainName: 'localhost',
    eventType,
    extendedRequestId: `${createUniqueId()}`,
    identity: {
      accountId: null,
      accessKey: null,
      caller: null,
      cognitoAuthenticationProvider: null,
      cognitoAuthenticationType: null,
      cognitoIdentityId: null,
      cognitoIdentityPoolId: null,
      principalOrgId: null,
      sourceIp: '127.0.0.1',
      user: null,
      userAgent: null,
      userArn: null,
    },
    messageDirection: 'IN',
    messageId: `${createUniqueId()}`,
    requestId: `${createUniqueId()}`,
    requestTime: formatToClfTime(now),
    requestTimeEpoch: now.getTime(),
    routeKey: action,
    stage: 'local',
  };
  if (connection) requestContext = { connectedAt: connection.connectionTime, connectionId:connection.connectionId, ...requestContext };

  return requestContext;
};

exports.createEvent = (action, eventType, connection, payload) => {
  const event = {
    body: payload,
    isBase64Encoded: false,
    requestContext: createRequestContext(action, eventType, connection),
  };

  return event;
};

exports.createConnectEvent = (action, eventType, connection, headers1, options) => {
  // const headers = {
  //   Host: 'localhost',
  //   'Sec-WebSocket-Extensions': 'permessage-deflate; client_max_window_bits',
  //   'Sec-WebSocket-Key': `${getUniqueId()}`,
  //   'Sec-WebSocket-Version': '13',
  //   'X-Amzn-Trace-Id': `Root=${getUniqueId()}`,
  //   'X-Forwarded-For': '127.0.0.1',
  //   'X-Forwarded-Port': `${options.port + 1}`,
  //   'X-Forwarded-Proto': `http${options.httpsProtocol ? 's' : ''}`,
  // };
  const toUpperCase = str => {
    const splitStr = str.toLowerCase().split('-');
    for (let i = 0; i < splitStr.length; i++) {
      splitStr[i] = splitStr[i].charAt(0).toUpperCase() + splitStr[i].substring(1);     
    }
    
    return splitStr.join('-'); 
  };
  const headers2 = { ...headers1 };
  delete headers2.connection; delete headers2.upgrade;

  const headers = {};
  Object.keys(headers2).map(key => headers[key
    .replace('sec-websocket-extensions', 'Sec-WebSocket-Extensions')
    .replace('sec-websocket-key', 'Sec-WebSocket-Key')
    .replace('sec-websocket-version', 'Sec-WebSocket-Version')
    .replace('host', 'Host')] = headers2[key]);
  headers['X-Forwarded-For'] = '127.0.0.1';
  headers['X-Amzn-Trace-Id'] = `Root=${getUniqueId()}`;
  headers['X-Forwarded-Port'] = `${options.port + 1}`;
  headers['X-Forwarded-Proto'] = `http${options.httpsProtocol ? 's' : ''}`;  

  const multiValueHeaders = createMultiValueHeaders(headers);
  const event = {
    headers,
    isBase64Encoded: false,
    multiValueHeaders,
    requestContext: createRequestContext(action, eventType, connection),
  };

  return event;
};

exports.createDisconnectEvent = (action, eventType, connection) => {
  const headers = {
    Host: 'localhost',
    'x-api-key': '',
    'x-restapi': '',
  };
  const multiValueHeaders = createMultiValueHeaders(headers);
  const event = {
    headers,
    isBase64Encoded: false,
    multiValueHeaders,
    requestContext: createRequestContext(action, eventType, connection),
  };

  return event;
};
