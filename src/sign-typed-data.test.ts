// Allow using snapshots in this file.
/*
eslint jest/no-restricted-matchers: [
  'error',
  {
    resolves: 'Use `expect(await promise)` instead.',
    toBeFalsy: 'Avoid `toBeFalsy`',
    toBeTruthy: 'Avoid `toBeTruthy`',
  }
]
*/
/* eslint-disable @typescript-eslint/restrict-template-expressions */

import * as ethUtil from '@ethereumjs/util';
import Ajv from 'ajv';

import {
  recoverTypedSignature,
  signTypedData,
  TypedDataUtils,
  typedSignatureHash,
  SignTypedDataVersion,
  TYPED_MESSAGE_SCHEMA,
} from './sign-typed-data';

const privateKey = Buffer.from(
  '4af1bceebf7f3634ec3cff8a2c38e51178d5d4ce585c52d6043e5e2cc3418bb0',
  'hex',
);

/**
 * Get a list of all Solidity types supported by EIP-712.
 *
 * @returns A list of all supported Solidity types.
 */
function getEip712SolidityTypes() {
  const types = ['bool', 'address', 'string', 'bytes'];
  const ints = Array.from(new Array(32)).map(
    (_, index) => `int${(index + 1) * 8}`,
  );
  const uints = Array.from(new Array(32)).map(
    (_, index) => `uint${(index + 1) * 8}`,
  );
  const bytes = Array.from(new Array(32)).map(
    (_, index) => `bytes${index + 1}`,
  );

  return [...types, ...ints, ...uints, ...bytes];
}

const eip712SolidityTypes = getEip712SolidityTypes();

/**
 * Validate the given message with the typed message schema.
 *
 * @param typedMessage - The typed message to validate.
 * @returns Whether the message is valid.
 */
function validateTypedMessageSchema(
  typedMessage: Record<string, unknown>,
): boolean {
  const ajv = new Ajv();
  const validate = ajv.compile(TYPED_MESSAGE_SCHEMA);
  return validate(typedMessage);
}

describe('TYPED_MESSAGE_SCHEMA', () => {
  it('should match valid typed message', () => {
    const typedMessage = {
      domain: {},
      message: {},
      primaryType: 'object',
      types: {
        EIP712Domain: [],
      },
    };

    expect(validateTypedMessageSchema(typedMessage)).toBe(true);
  });

  it('should allow custom types in addition to domain', () => {
    const typedMessage = {
      domain: {},
      message: {},
      primaryType: 'Message',
      types: {
        EIP712Domain: [],
        Message: [],
      },
    };

    expect(validateTypedMessageSchema(typedMessage)).toBe(true);
  });

  eip712SolidityTypes.forEach((solidityType) => {
    it(`should allow custom type to have type of '${solidityType}'`, () => {
      const typedMessage = {
        domain: {},
        message: {},
        primaryType: 'Message',
        types: {
          EIP712Domain: [],
          Message: [{ name: 'data', type: solidityType }],
        },
      };

      expect(validateTypedMessageSchema(typedMessage)).toBe(true);
    });
  });

  it('should allow custom type to have a custom type', () => {
    const typedMessage = {
      domain: {},
      message: {},
      primaryType: 'Message',
      types: {
        CustomValue: [{ name: 'value', type: 'string' }],
        EIP712Domain: [],
        Message: [{ name: 'data', type: 'CustomValue' }],
      },
    };

    expect(validateTypedMessageSchema(typedMessage)).toBe(true);
  });

  const invalidStrings = [undefined, null, 0, 1, [], {}];

  for (const invalidString of invalidStrings) {
    it(`should disallow a primary type with value '${invalidString}'`, () => {
      const typedMessage = {
        domain: {},
        message: {},
        primaryType: invalidString,
        types: {
          EIP712Domain: [],
        },
      };

      expect(validateTypedMessageSchema(typedMessage)).toBe(false);
    });
  }

  const invalidObjects = [undefined, null, 0, 1, [], '', 'test'];
  for (const invalidObject of invalidObjects) {
    it(`should disallow a typed message with value'${invalidObject}'`, () => {
      expect(validateTypedMessageSchema(invalidObject as any)).toBe(false);
    });

    it(`should disallow a domain with value '${invalidObject}'`, () => {
      const typedMessage = {
        domain: invalidObject,
        message: {},
        primaryType: 'object',
        types: {
          EIP712Domain: [],
        },
      };

      expect(validateTypedMessageSchema(typedMessage)).toBe(false);
    });

    it(`should disallow a message with value '${invalidObject}'`, () => {
      const typedMessage = {
        domain: {},
        message: invalidObject,
        primaryType: 'object',
        types: {
          EIP712Domain: [],
        },
      };

      expect(validateTypedMessageSchema(typedMessage)).toBe(false);
    });

    it(`should disallow types with value '${invalidObject}'`, () => {
      const typedMessage = {
        domain: {},
        message: {},
        primaryType: 'object',
        types: invalidObject,
      };

      expect(validateTypedMessageSchema(typedMessage)).toBe(false);
    });
  }

  it('should require custom type properties to have a name', () => {
    const typedMessage = {
      domain: {},
      message: {},
      primaryType: 'Message',
      types: {
        EIP712Domain: [],
        Message: [{ type: 'string' }],
      },
    };

    expect(validateTypedMessageSchema(typedMessage)).toBe(false);
  });

  it('should require custom type properties to have a type', () => {
    const typedMessage = {
      domain: {},
      message: {},
      primaryType: 'Message',
      types: {
        EIP712Domain: [],
        Message: [{ name: 'name' }],
      },
    };

    expect(validateTypedMessageSchema(typedMessage)).toBe(false);
  });

  const invalidTypes = [undefined, null, 0, 1, [], {}];

  for (const invalidType of invalidTypes) {
    it(`should disallow a type of '${invalidType}'`, () => {
      const typedMessage = {
        domain: {},
        message: {},
        primaryType: 'Message',
        types: {
          EIP712Domain: [],
          Message: [{ name: 'name', type: invalidType }],
        },
      };

      expect(validateTypedMessageSchema(typedMessage)).toBe(false);
    });
  }
});

const MAX_SAFE_INTEGER_AS_HEX = `0x${Number.MAX_SAFE_INTEGER.toString(16)}`; // 0x1fffffffffffff - contains an even number of characters (16)
const MAX_SAFE_INTEGER_PLUS_ONE_CHAR_AS_HEX = `0x${Number.MAX_SAFE_INTEGER.toString(
  16,
)}1`; // 0x1fffffffffffff1 or 144115188075855860 - contains an odd number of characters in hexadecimal format (17) and is greater than MAX_SAFE_INTEGER

/*
  we test both even and odd length hex values because Node's Buffer.from() method does not buffer hex numbers correctly
 so we conditionally prepend hexstrings with a zero before buffering them depending on whether the string contains an 
 even or odd number of characters 
 */

const encodeDataExamples = {
  // dynamic types supported by EIP-712:
  bytes: [
    10,
    '10',
    '0x10', // even
    '0x101', // odd
    Buffer.from('10', 'utf8'),
    '0xa22cb465000000000000000000000000a9079d872d10185b54c5db2c36cc978cbd3f72b70000000000000000000000000000000000000000000000000000000000000001', // even number of characters hex string with value greater than MAX_SAFE_INTEGER
    MAX_SAFE_INTEGER_AS_HEX,
    MAX_SAFE_INTEGER_PLUS_ONE_CHAR_AS_HEX,
    '0x',
    '0x0',
  ],
  string: [
    'Hello!',
    '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
    '0xabcd', // even
    '0xabcde', // odd
    '😁',
    10,
    MAX_SAFE_INTEGER_AS_HEX,
    MAX_SAFE_INTEGER_PLUS_ONE_CHAR_AS_HEX,
  ],
  // atomic types supported by EIP-712:
  address: [
    '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
    '0x0', // odd
    '0x10', // even
    10,
    'bBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
    Number.MAX_SAFE_INTEGER,
    MAX_SAFE_INTEGER_AS_HEX,
    MAX_SAFE_INTEGER_PLUS_ONE_CHAR_AS_HEX,
  ],
  bool: [true, false, 'true', 'false', 0, 1, -1, Number.MAX_SAFE_INTEGER],
  bytes1: [
    '0x10', // even
    '0x101', // odd
    10,
    0,
    1,
    -1,
    Number.MAX_SAFE_INTEGER,
    Buffer.from('10', 'utf8'),
    MAX_SAFE_INTEGER_AS_HEX,
    MAX_SAFE_INTEGER_PLUS_ONE_CHAR_AS_HEX,
  ],
  bytes32: [
    '0x10', // even
    '0x101', // odd
    10,
    0,
    1,
    -1,
    Number.MAX_SAFE_INTEGER,
    Buffer.from('10', 'utf8'),
    MAX_SAFE_INTEGER_AS_HEX,
    MAX_SAFE_INTEGER_PLUS_ONE_CHAR_AS_HEX,
  ],
  int8: [0, '0', '0x0', 255, -255],
  int256: [0, '0', '0x0', Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER],
  uint8: [0, '0', '0x0', 255],
  uint256: [0, '0', '0x0', Number.MAX_SAFE_INTEGER],
  // atomic types not supported by EIP-712:
  int: [0, '0', '0x0', Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER], // interpreted as `int256` by `ethereumjs-abi`
  uint: [0, '0', '0x0', Number.MAX_SAFE_INTEGER], // interpreted as `uint256` by `ethereumjs-abi`
  // `fixed` and `ufixed` types omitted because their encoding in `ethereumjs-abi` is very broken at the moment.
  // `function` type omitted because it is not supported by `ethereumjs-abi`.
};

const encodeDataErrorExamples = {
  address: [
    {
      input: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB0',
      errorMessage:
        'Unable to encode value: Invalid address value. Expected address to be 20 bytes long, but received 21 bytes.',
    },
  ],
  int8: [
    {
      input: '256',
      errorMessage:
        'Unable to encode value: Number "256" is out of range for type "int8".',
    },
  ],
  uint: [{ input: -1, errorMessage: 'Value must be a non-negative bigint.' }],
  uint8: [{ input: -1, errorMessage: 'Value must be a non-negative bigint.' }],
  uint256: [
    { input: -1, errorMessage: 'Value must be a non-negative bigint.' },
  ],
  bytes1: [
    {
      input: 'a',
      errorMessage:
        'An unexpected error occurred: Expected a bytes-like value, got "a".',
    },
    {
      input: 'test',
      errorMessage:
        'An unexpected error occurred: Expected a bytes-like value, got "test".',
    },
  ],
  bytes32: [
    {
      input: 'a',
      errorMessage:
        'An unexpected error occurred: Expected a bytes-like value, got "a".',
    },
    {
      input: 'test',
      errorMessage:
        'An unexpected error occurred: Expected a bytes-like value, got "test".',
    },
  ],
};

// Union of all types from both sets of examples
const allExampleTypes = [
  ...new Set(
    Object.keys(encodeDataExamples).concat(
      Object.keys(encodeDataErrorExamples),
    ),
  ),
];

describe('TypedDataUtils.encodeData', function () {
  // The `TypedDataUtils.encodeData` function accepts most Solidity data types, as well as custom
  // data types defined by the types provided. The supported Solidity data types are divided into
  // two types: atomic and dynamic. Atomic types are of a fixed size (e.g. `int8`), whereas dynamic
  // types can vary in size (e.g. strings, bytes). We also test arrays of each of these types.
  //
  // The tests below test all boundary conditions of each Solidity type. These tests are
  // automatically constructed using the example data above ("encodeDataExamples" and
  // "encodeDataErrorExamples"). The behaviour for `null` and `undefined` inputs does vary between
  // atomic, dynamic, and custom types though, so each of these three categories is tested
  // separately with `null` and `undefined` input. Lastly, there are more tests for various other
  // edge cases.
  //
  // The behavior differs between V3 and V4, so each test has been run for each version. We also
  // have a block of tests to verify that signatures that match between V3 and V4 remain identical,
  // and that signatures that differ between V3 and V4 remain different.
  //
  // To make reading and maintaining these tests easier, the order will be the same throughout all
  // 4 of these test suites. Here is a table showing that order, as well as the compatibility of
  // each input type with V3 and V4 `encodeData`. The table also shows whether the signature is
  // identical between versions in the cases where the input can be encoded in both versions.
  //
  // | Input type                                           | V3 | V4 | Matching Signatures |
  // | ---------------------------------------------------- | -- | -- | ------------------- |
  // | Auto-generated tests from the example data           | Y  | Y  | Y                   |
  // | Arrays using the example data                        | N  | Y  |                     |
  // | Custom type                                          | Y  | Y  | Y                   |
  // | Recursive custom type                                | Y  | Y  | N                   |
  // | Custom type array                                    | N  | Y  |                     |
  // | Custom type with extra properties                    | Y  | Y  | Y                   |
  // | Atomic type with `null` input                        | N  | N  |                     |
  // | Atomic type with `undefined` input                   | Y  | N  |                     |
  // | Dynamic type with `null` input                       | Y  | Y  | Y                   |
  // | Dynamic type with `undefined` input                  | Y  | N  |                     |
  // | Custom type with `null` input                        | N  | Y  |                     |
  // | Custom type with `undefined` input                   | Y  | Y  | N                   |
  // | Functions                                            | N  | N  |                     |
  // | Unrecognized primary type                            | N  | N  |                     |
  // | Unrecognized non-primary type                        | N  | N  |                     |
  // | Extra type specified that isn't used by primary type | Y  | Y  | Y                   |
  //
  // Note that these tests should mirror the `TypedDataUtils.hashStruct` tests. The `hashStruct`
  // function just calls `encodeData` and hashes the result.

  describe('V3', function () {
    describe('example data', function () {
      for (const type of allExampleTypes) {
        describe(`type "${type}"`, function () {
          // Test all examples that do not crash
          const inputs = encodeDataExamples[type] || [];
          for (const input of inputs) {
            const inputType = input instanceof Buffer ? 'Buffer' : typeof input;
            it(`should encode "${input}" (type "${inputType}")`, function () {
              const types = {
                Message: [{ name: 'data', type }],
              };
              const message = { data: input };

              expect(
                TypedDataUtils.encodeData(
                  'Message',
                  message,
                  types,
                  SignTypedDataVersion.V3,
                ).toString('hex'),
              ).toMatchSnapshot();
            });
          }

          // Test all examples that crash
          const errorInputs = encodeDataErrorExamples[type] || [];
          for (const { input, errorMessage } of errorInputs) {
            const inputType = input instanceof Buffer ? 'Buffer' : typeof input;
            it(`should fail to encode "${input}" (type "${inputType}")`, function () {
              const types = {
                Message: [{ name: 'data', type }],
              };
              const message = { data: input };

              expect(() =>
                TypedDataUtils.encodeData(
                  'Message',
                  message,
                  types,
                  SignTypedDataVersion.V3,
                ).toString('hex'),
              ).toThrow(errorMessage);
            });
          }

          it(`should fail to encode array of all ${type} example data`, function () {
            const types = {
              Message: [{ name: 'data', type: `${type}[]` }],
            };
            const message = { data: inputs };
            expect(() =>
              TypedDataUtils.encodeData(
                'Message',
                message,
                types,
                SignTypedDataVersion.V3,
              ).toString('hex'),
            ).toThrow(
              'Arrays are unimplemented in encodeData; use V4 extension',
            );
          });
        });
      }
    });

    it('should encode data with custom type', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: 'Hello, Bob!',
      };

      expect(
        TypedDataUtils.encodeData(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V3,
        ).toString('hex'),
      ).toMatchSnapshot();
    });

    it('should encode data with a recursive data type', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
          { name: 'replyTo', type: 'Mail' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: 'Hello, Bob!',
        replyTo: {
          to: {
            name: 'Cow',
            wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
          },
          from: {
            name: 'Bob',
            wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
          },
          contents: 'Hello!',
        },
      };

      expect(
        TypedDataUtils.encodeData(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V3,
        ).toString('hex'),
      ).toMatchSnapshot();
    });

    it('should throw an error when trying to encode a custom type array', function () {
      const types = {
        Message: [{ name: 'data', type: 'string[]' }],
      };
      const message = { data: ['1', '2', '3'] };

      expect(() =>
        TypedDataUtils.encodeData(
          'Message',
          message,
          types,
          SignTypedDataVersion.V3,
        ).toString('hex'),
      ).toThrow('Arrays are unimplemented in encodeData; use V4 extension');
    });

    it('should ignore extra unspecified message properties', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: 'Hello, Bob!',
      };

      const originalSignature = TypedDataUtils.encodeData(
        primaryType,
        message,
        types,
        SignTypedDataVersion.V3,
      ).toString('hex');
      const messageWithExtraProperties = { ...message, foo: 'bar' };
      const signatureWithExtraProperties = TypedDataUtils.encodeData(
        primaryType,
        messageWithExtraProperties,
        types,
        SignTypedDataVersion.V3,
      ).toString('hex');

      expect(originalSignature).toBe(signatureWithExtraProperties);
    });

    it('should throw an error when an atomic property is set to null', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
          { name: 'length', type: 'int32' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: 'Hello!',
        length: null,
      };

      expect(() =>
        TypedDataUtils.encodeData(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V3,
        ).toString('hex'),
      ).toThrow(
        'Unable to encode value: Invalid number. Expected a valid number value, but received "null".',
      );
    });

    it('should encode data with an atomic property set to undefined', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
          { name: 'length', type: 'int32' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: 'Hello!',
        length: undefined,
      };

      expect(
        TypedDataUtils.encodeData(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V3,
        ).toString('hex'),
      ).toMatchSnapshot();
    });

    it('should encode data with a dynamic property set to null', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: null,
      };

      expect(
        TypedDataUtils.encodeData(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V3,
        ).toString('hex'),
      ).toMatchSnapshot();
    });

    it('should encode data with a dynamic property set to undefined', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: undefined,
      };

      expect(
        TypedDataUtils.encodeData(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V3,
        ).toString('hex'),
      ).toMatchSnapshot();
    });

    it('should throw an error when a custom type property is set to null', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        to: null,
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        contents: 'Hello, Bob!',
      };

      expect(() =>
        TypedDataUtils.encodeData(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V3,
        ).toString('hex'),
      ).toThrow(/^Cannot read prop.+ null/u);
    });

    it('should encode data with a custom type property set to undefined', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: undefined,
        contents: 'Hello, Bob!',
      };

      expect(
        TypedDataUtils.encodeData(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V3,
        ).toString('hex'),
      ).toMatchSnapshot();
    });

    it('should throw an error when trying to encode a function', function () {
      const types = {
        Message: [{ name: 'data', type: 'function' }],
      };
      const message = { data: 'test' };

      expect(() =>
        TypedDataUtils.encodeData(
          'Message',
          message,
          types,
          SignTypedDataVersion.V3,
        ).toString('hex'),
      ).toThrow('Unsupported or invalid type: "function"');
    });

    it('should throw an error when trying to encode with a missing primary type definition', function () {
      const types = {};
      const message = { data: 'test' };

      expect(() =>
        TypedDataUtils.encodeData(
          'Message',
          message,
          types,
          SignTypedDataVersion.V3,
        ).toString('hex'),
      ).toThrow('No type definition specified: Message');
    });

    it('should throw an error when trying to encode an unrecognized type', function () {
      const types = {
        Message: [{ name: 'data', type: 'foo' }],
      };
      const message = { data: 'test' };

      expect(() =>
        TypedDataUtils.encodeData(
          'Message',
          message,
          types,
          SignTypedDataVersion.V3,
        ).toString('hex'),
      ).toThrow('Unable to encode value: The type "foo" is not supported.');
    });

    it('should encode data when given extraneous types', function () {
      const types = {
        Message: [{ name: 'data', type: 'string' }],
        Extra: [{ name: 'data', type: 'string' }],
      };
      const message = { data: 'Hello!' };

      expect(
        TypedDataUtils.encodeData(
          'Message',
          message,
          types,
          SignTypedDataVersion.V3,
        ).toString('hex'),
      ).toMatchSnapshot();
    });

    it('should encode data when called unbound', function () {
      const types = {
        Message: [{ name: 'data', type: 'string' }],
      };
      const message = { data: 'Hello!' };
      const primaryType = 'Message';
      const { hashStruct } = TypedDataUtils;

      expect(
        hashStruct(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V3,
        ).toString('hex'),
      ).toMatchSnapshot();
    });
  });

  describe('V4', function () {
    describe('example data', function () {
      for (const type of allExampleTypes) {
        describe(`type "${type}"`, function () {
          // Test all examples that do not crash
          const inputs = encodeDataExamples[type] || [];
          for (const input of inputs) {
            const inputType = input instanceof Buffer ? 'Buffer' : typeof input;
            it(`should encode "${input}" (type "${inputType}")`, function () {
              const types = {
                Message: [{ name: 'data', type }],
              };
              const message = { data: input };

              expect(
                TypedDataUtils.encodeData(
                  'Message',
                  message,
                  types,
                  SignTypedDataVersion.V4,
                ).toString('hex'),
              ).toMatchSnapshot();
            });
          }

          // Test all examples that crash
          const errorInputs = encodeDataErrorExamples[type] || [];
          for (const { input, errorMessage } of errorInputs) {
            const inputType = input instanceof Buffer ? 'Buffer' : typeof input;
            it(`should fail to encode "${input}" (type "${inputType}")`, function () {
              const types = {
                Message: [{ name: 'data', type }],
              };
              const message = { data: input };

              expect(() =>
                TypedDataUtils.encodeData(
                  'Message',
                  message,
                  types,
                  SignTypedDataVersion.V4,
                ).toString('hex'),
              ).toThrow(errorMessage);
            });
          }

          it(`should encode array of all ${type} example data`, function () {
            const types = {
              Message: [{ name: 'data', type: `${type}[]` }],
            };
            const message = { data: inputs };
            expect(
              TypedDataUtils.encodeData(
                'Message',
                message,
                types,
                SignTypedDataVersion.V4,
              ).toString('hex'),
            ).toMatchSnapshot();
          });
        });
      }
    });

    it('should encode data with custom type', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: 'Hello, Bob!',
      };

      expect(
        TypedDataUtils.encodeData(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V4,
        ).toString('hex'),
      ).toMatchSnapshot();
    });

    it('should encode data with a recursive data type', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
          { name: 'replyTo', type: 'Mail' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: 'Hello, Bob!',
        replyTo: {
          to: {
            name: 'Cow',
            wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
          },
          from: {
            name: 'Bob',
            wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
          },
          contents: 'Hello!',
        },
      };

      expect(
        TypedDataUtils.encodeData(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V4,
        ).toString('hex'),
      ).toMatchSnapshot();
    });

    it('should encode data with a custom data type array', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address[]' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person[]' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: [
            '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
            '0xDD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
          ],
        },
        to: [
          {
            name: 'Bob',
            wallet: ['0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB'],
          },
        ],
        contents: 'Hello, Bob!',
      };

      expect(
        TypedDataUtils.encodeData(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V4,
        ).toString('hex'),
      ).toMatchSnapshot();
    });

    it('should ignore extra unspecified message properties', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: 'Hello, Bob!',
      };

      const originalSignature = TypedDataUtils.encodeData(
        primaryType,
        message,
        types,
        SignTypedDataVersion.V4,
      ).toString('hex');
      const messageWithExtraProperties = { ...message, foo: 'bar' };
      const signatureWithExtraProperties = TypedDataUtils.encodeData(
        primaryType,
        messageWithExtraProperties,
        types,
        SignTypedDataVersion.V4,
      ).toString('hex');

      expect(originalSignature).toBe(signatureWithExtraProperties);
    });

    it('should throw an error when an atomic property is set to null', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
          { name: 'length', type: 'int32' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: 'Hello!',
        length: null,
      };

      expect(() =>
        TypedDataUtils.encodeData(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V4,
        ).toString('hex'),
      ).toThrow(
        'Unable to encode value: Invalid number. Expected a valid number value, but received "null".',
      );
    });

    it('should throw an error when an atomic property is set to undefined', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
          { name: 'length', type: 'int32' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: 'Hello!',
        length: undefined,
      };

      expect(() =>
        TypedDataUtils.encodeData(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V4,
        ).toString('hex'),
      ).toThrow('missing value for field length of type int32');
    });

    it('should encode data with a dynamic property set to null', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: null,
      };

      expect(
        TypedDataUtils.encodeData(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V4,
        ).toString('hex'),
      ).toMatchSnapshot();
    });

    it('should throw an error when a dynamic property is set to undefined', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: undefined,
      };

      expect(() =>
        TypedDataUtils.encodeData(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V4,
        ).toString('hex'),
      ).toThrow('missing value for field contents of type string');
    });

    it('should encode data with a custom type property set to null', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        to: null,
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        contents: 'Hello, Bob!',
      };

      expect(
        TypedDataUtils.encodeData(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V4,
        ).toString('hex'),
      ).toMatchSnapshot();
    });

    it('should encode data with a custom type property set to undefined', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: undefined,
        contents: 'Hello, Bob!',
      };

      expect(
        TypedDataUtils.encodeData(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V4,
        ).toString('hex'),
      ).toMatchSnapshot();
    });

    it('should throw an error when trying to encode a function', function () {
      const types = {
        Message: [{ name: 'data', type: 'function' }],
      };
      const message = { data: 'test' };

      expect(() =>
        TypedDataUtils.encodeData(
          'Message',
          message,
          types,
          SignTypedDataVersion.V4,
        ).toString('hex'),
      ).toThrow('Unsupported or invalid type: "function"');
    });

    it('should throw an error when trying to encode with a missing primary type definition', function () {
      const types = {};
      const message = { data: 'test' };

      expect(() =>
        TypedDataUtils.encodeData(
          'Message',
          message,
          types,
          SignTypedDataVersion.V4,
        ).toString('hex'),
      ).toThrow('No type definition specified: Message');
    });

    it('should throw an error when trying to encode an unrecognized type', function () {
      const types = {
        Message: [{ name: 'data', type: 'foo' }],
      };
      const message = { data: 'test' };

      expect(() =>
        TypedDataUtils.encodeData(
          'Message',
          message,
          types,
          SignTypedDataVersion.V4,
        ).toString('hex'),
      ).toThrow('Unable to encode value: The type "foo" is not supported.');
    });

    it('should encode data when given extraneous types', function () {
      const types = {
        Message: [{ name: 'data', type: 'string' }],
        Extra: [{ name: 'data', type: 'string' }],
      };
      const message = { data: 'Hello!' };

      expect(
        TypedDataUtils.encodeData(
          'Message',
          message,
          types,
          SignTypedDataVersion.V4,
        ).toString('hex'),
      ).toMatchSnapshot();
    });

    it('should encode data when called unbound', function () {
      const types = {
        Message: [{ name: 'data', type: 'string' }],
      };
      const message = { data: 'Hello!' };
      const primaryType = 'Message';
      const { encodeData } = TypedDataUtils;

      expect(
        encodeData(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V4,
        ).toString('hex'),
      ).toMatchSnapshot();
    });
  });

  // This test suite covers all cases where data should be encoded identically
  // on V3 and V4
  describe('V3/V4 identical encodings', function () {
    describe('example data', function () {
      for (const type of allExampleTypes) {
        describe(`type "${type}"`, function () {
          // Test all examples that do not crash
          const inputs = encodeDataExamples[type] || [];
          for (const input of inputs) {
            const inputType = input instanceof Buffer ? 'Buffer' : typeof input;
            it(`should encode "${input}" (type "${inputType}")`, function () {
              const types = {
                Message: [{ name: 'data', type }],
              };
              const message = { data: input };

              const v3Signature = TypedDataUtils.encodeData(
                'Message',
                message,
                types,
                SignTypedDataVersion.V3,
              ).toString('hex');
              const v4Signature = TypedDataUtils.encodeData(
                'Message',
                message,
                types,
                SignTypedDataVersion.V4,
              ).toString('hex');

              expect(v3Signature).toBe(v4Signature);
            });
          }
        });
      }
    });

    it('should encode data with custom type', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: 'Hello, Bob!',
      };

      const v3Signature = TypedDataUtils.encodeData(
        primaryType,
        message,
        types,
        SignTypedDataVersion.V3,
      ).toString('hex');
      const v4Signature = TypedDataUtils.encodeData(
        primaryType,
        message,
        types,
        SignTypedDataVersion.V4,
      ).toString('hex');

      expect(v3Signature).toBe(v4Signature);
    });

    it('should ignore extra unspecified message properties', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: 'Hello, Bob!',
      };

      const originalV3Signature = TypedDataUtils.encodeData(
        primaryType,
        message,
        types,
        SignTypedDataVersion.V3,
      ).toString('hex');
      const originalV4Signature = TypedDataUtils.encodeData(
        primaryType,
        message,
        types,
        SignTypedDataVersion.V4,
      ).toString('hex');
      const messageWithExtraProperties = { ...message, foo: 'bar' };
      const v3signatureWithExtraProperties = TypedDataUtils.encodeData(
        primaryType,
        messageWithExtraProperties,
        types,
        SignTypedDataVersion.V3,
      ).toString('hex');
      const v4signatureWithExtraProperties = TypedDataUtils.encodeData(
        primaryType,
        messageWithExtraProperties,
        types,
        SignTypedDataVersion.V4,
      ).toString('hex');

      expect(originalV3Signature).toBe(originalV4Signature);
      expect(v3signatureWithExtraProperties).toBe(
        v4signatureWithExtraProperties,
      );
    });

    it('should encode data with a dynamic property set to null', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: null,
      };

      const v3Signature = TypedDataUtils.encodeData(
        primaryType,
        message,
        types,
        SignTypedDataVersion.V3,
      ).toString('hex');
      const v4Signature = TypedDataUtils.encodeData(
        primaryType,
        message,
        types,
        SignTypedDataVersion.V4,
      ).toString('hex');

      expect(v3Signature).toBe(v4Signature);
    });

    it('should encode data when given extraneous types', function () {
      const types = {
        Message: [{ name: 'data', type: 'string' }],
        Extra: [{ name: 'data', type: 'string' }],
      };
      const message = { data: 'Hello!' };

      const v3Signature = TypedDataUtils.encodeData(
        'Message',
        message,
        types,
        SignTypedDataVersion.V3,
      ).toString('hex');
      const v4Signature = TypedDataUtils.encodeData(
        'Message',
        message,
        types,
        SignTypedDataVersion.V4,
      ).toString('hex');

      expect(v3Signature).toBe(v4Signature);
    });
  });

  // This test suite covers all cases where data should be encoded differently
  // on V3 and V4
  describe('V3/V4 encoding differences', () => {
    // Recursive data structures are encoded differently because V4 encodes
    // missing custom typed properties as 0 byte32 rather than omitting it,
    // and all recursive data structures must include a missing custom typed
    // property (the recursive one), or they'd be infinitely large or cyclic.
    // And cyclic data structures are not supported.
    it('should encode data with recursive data differently', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
          { name: 'replyTo', type: 'Mail' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: 'Hello, Bob!',
        replyTo: {
          to: {
            name: 'Cow',
            wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
          },
          from: {
            name: 'Bob',
            wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
          },
          contents: 'Hello!',
        },
      };

      const v3Signature = TypedDataUtils.encodeData(
        primaryType,
        message,
        types,
        SignTypedDataVersion.V3,
      ).toString('hex');
      const v4Signature = TypedDataUtils.encodeData(
        primaryType,
        message,
        types,
        SignTypedDataVersion.V4,
      ).toString('hex');

      expect(v3Signature).not.toBe(v4Signature);
    });

    // Missing custom type properties are omitted in V3, but encoded as 0 (bytes32) in V4
    it('should encode missing custom type properties differently', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        contents: 'Hello, Bob!',
      };

      const v3Signature = TypedDataUtils.encodeData(
        primaryType,
        message,
        types,
        SignTypedDataVersion.V3,
      ).toString('hex');
      const v4Signature = TypedDataUtils.encodeData(
        primaryType,
        message,
        types,
        SignTypedDataVersion.V4,
      ).toString('hex');

      expect(v3Signature).not.toBe(v4Signature);
    });
  });

  it('should throw if passed an invalid version', () => {
    const types = {
      Message: [{ name: 'data', type: 'string' }],
    };
    const message = { data: 'Hello!' };
    expect(() =>
      TypedDataUtils.encodeData(
        'Message',
        message,
        types,
        'V0' as any,
      ).toString('hex'),
    ).toThrow('Invalid version');
  });

  it('should throw if passed a version that is not allowed', () => {
    const types = {
      Message: [{ name: 'data', type: 'string' }],
    };
    const message = { data: 'Hello!' };
    expect(() =>
      TypedDataUtils.encodeData(
        'Message',
        message,
        types,
        SignTypedDataVersion.V1 as any,
      ).toString('hex'),
    ).toThrow('SignTypedDataVersion not allowed');
  });
});

describe('TypedDataUtils.hashStruct', function () {
  // These tests mirror the `TypedDataUtils.encodeData` tests. The same inputs are expected.
  // See the `encodeData` test comments for more information about these test cases.
  describe('V3', function () {
    describe('example data', function () {
      for (const type of allExampleTypes) {
        describe(`type "${type}"`, function () {
          // Test all examples that do not crash
          const inputs = encodeDataExamples[type] || [];
          for (const input of inputs) {
            const inputType = input instanceof Buffer ? 'Buffer' : typeof input;
            it(`should hash "${input}" (type "${inputType}")`, function () {
              const types = {
                Message: [{ name: 'data', type }],
              };
              const message = { data: input };

              expect(
                TypedDataUtils.hashStruct(
                  'Message',
                  message,
                  types,
                  SignTypedDataVersion.V3,
                ).toString('hex'),
              ).toMatchSnapshot();
            });
          }

          // Test all examples that crash
          const errorInputs = encodeDataErrorExamples[type] || [];
          for (const { input, errorMessage } of errorInputs) {
            const inputType = input instanceof Buffer ? 'Buffer' : typeof input;
            it(`should fail to hash "${input}" (type "${inputType}")`, function () {
              const types = {
                Message: [{ name: 'data', type }],
              };
              const message = { data: input };

              expect(() =>
                TypedDataUtils.hashStruct(
                  'Message',
                  message,
                  types,
                  SignTypedDataVersion.V3,
                ).toString('hex'),
              ).toThrow(errorMessage);
            });
          }

          it(`should fail to hash array of all ${type} example data`, function () {
            const types = {
              Message: [{ name: 'data', type: `${type}[]` }],
            };
            const message = { data: inputs };
            expect(() =>
              TypedDataUtils.hashStruct(
                'Message',
                message,
                types,
                SignTypedDataVersion.V3,
              ).toString('hex'),
            ).toThrow(
              'Arrays are unimplemented in encodeData; use V4 extension',
            );
          });
        });
      }
    });

    it('should hash data with custom type', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: 'Hello, Bob!',
      };

      expect(
        TypedDataUtils.hashStruct(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V3,
        ).toString('hex'),
      ).toMatchSnapshot();
    });

    it('should hash data with custom type22222222222222', function () {
      const types = {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person[]' },
          { name: 'to', type: 'Person[]' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const domain = {
        // This defines the network, in this case, Mainnet.
        chainId: 1,
        // Give a user-friendly name to the specific contract you're signing for.
        name: 'Ether Mail',
        // Add a verifying contract to make sure you're establishing contracts with the proper entity.
        verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
        // This identifies the latest version.
        version: '1',
      };
      const message = {
        from: [{
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },{
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        }],
        to: [{
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        }, {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        }],
        contents: 'Hello, Bob!',
      };

      console.log('++++++++',
        TypedDataUtils.eip712Hash(
          {
            types,
            primaryType,
            domain,
            message,
          },
          SignTypedDataVersion.V4,
        ).toString('hex'));
    });

    it('should hash deploy data', function () {
      const types = {
        // This refers to the domain the contract is hosted on.
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        Deploy: [
          { name: 'metadata', type: 'DeployMetadata' },
          { name: 'fee_inputs', type: 'Input[]' },
          { name: 'fee_outputs', type: 'Output[]' }
        ],
        OmniverseUTXO: [
          { name: 'tx_type', type: 'string' },
          { name: 'detail', type: 'Deploy' }
        ],
        DeployMetadata: [
          { name: 'salt', type: 'bytes8' },
          { name: 'name', type: 'string' },
          { name: 'deployer', type: 'bytes32' },
          { name: 'limit', type: 'uint128' },
          { name: 'price', type: 'uint128' },
          { name: 'total_supply', type: 'uint128' }
        ],
        Input: [
          { name: 'txid', type: 'bytes32' },
          { name: 'index', type: 'uint32' },
          { name: 'amount', type: 'uint128' },
          { name: 'address', type: 'bytes32' }
        ],
        Output: [
          { name: 'amount', type: 'uint128' },
          { name: 'address', type: 'bytes32' }
        ]
      };
      const primaryType = 'OmniverseUTXO';
      const domain = {
        // This defines the network, in this case, Mainnet.
        chainId: 1,
        // Give a user-friendly name to the specific contract you're signing for.
        name: 'Omniverse Transaction',
        // Add a verifying contract to make sure you're establishing contracts with the proper entity.
        verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
        // This identifies the latest version.
        version: '1',
      };
      const message = {
        tx_type: 'Deploy',
        detail: {
          metadata: {
            salt: "0x1122334455667788",
            name: "test_token",
            deployer: "0x1122334455667788112233445566778811223344556677881122334455667788",
            limit: "1234605616436508552",
            price: "1234605616436508552",
            total_supply: "1234605616436508552"
          },
          fee_inputs: [{
            txid: "0x1122334455667788112233445566778811223344556677881122334455667788",
            index: "287454020",
            amount: "1234605616436508552",
            address: "0x1122334455667788112233445566778811223344556677881122334455667788"
          }],
          fee_outputs: [{
            address: "0x1122334455667788112233445566778811223344556677881122334455667788",
            amount: "1234605616436508552"
          }]
        }
      };

      console.log('Deploy hash',
        TypedDataUtils.eip712Hash(
          {
            types,
            primaryType,
            domain,
            message,
          },
          SignTypedDataVersion.V4,
        ));
    });

    it('should hash mint data', function () {
      const types = {
        // This refers to the domain the contract is hosted on.
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        Mint: [
          { name: 'asset_id', type: 'bytes32' },
          { name: 'outputs', type: 'Output[]' },
          { name: 'fee_inputs', type: 'Input[]' },
          { name: 'fee_outputs', type: 'Output[]' }
        ],
        OmniverseUTXO: [
          { name: 'tx_type', type: 'string' },
          { name: 'detail', type: 'Mint' }
        ],
        Input: [
          { name: 'txid', type: 'bytes32' },
          { name: 'index', type: 'uint32' },
          { name: 'amount', type: 'uint128' },
          { name: 'address', type: 'bytes32' }
        ],
        Output: [
          { name: 'amount', type: 'uint128' },
          { name: 'address', type: 'bytes32' }
        ]
      };
      const primaryType = 'OmniverseUTXO';
      const domain = {
        // This defines the network, in this case, Mainnet.
        chainId: 1,
        // Give a user-friendly name to the specific contract you're signing for.
        name: 'Omniverse Transaction',
        // Add a verifying contract to make sure you're establishing contracts with the proper entity.
        verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
        // This identifies the latest version.
        version: '1',
      };
      const message = {
        tx_type: 'Mint',
        detail: {
          asset_id: '0x1122334455667788112233445566778811223344556677881122334455667788',
          outputs: [{
            address: "0x1122334455667788112233445566778811223344556677881122334455667788",
            amount: "1234605616436508552"
          }],
          fee_inputs: [{
            txid: "0x1122334455667788112233445566778811223344556677881122334455667788",
            index: "287454020",
            amount: "1234605616436508552",
            address: "0x1122334455667788112233445566778811223344556677881122334455667788"
          }],
          fee_outputs: [{
            address: "0x1122334455667788112233445566778811223344556677881122334455667788",
            amount: "1234605616436508552"
          }]
        }
      };

      console.log('Mint hash',
        TypedDataUtils.eip712Hash(
          {
            types,
            primaryType,
            domain,
            message,
          },
          SignTypedDataVersion.V4,
        ));
    });

    it('should hash transfer data', function () {
      const types = {
        // This refers to the domain the contract is hosted on.
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        Transfer: [
          { name: 'asset_id', type: 'bytes32' },
          { name: 'inputs', type: 'Input[]' },
          { name: 'outputs', type: 'Output[]' },
          { name: 'fee_inputs', type: 'Input[]' },
          { name: 'fee_outputs', type: 'Output[]' }
        ],
        OmniverseUTXO: [
          { name: 'tx_type', type: 'string' },
          { name: 'detail', type: 'Transfer' }
        ],
        Input: [
          { name: 'txid', type: 'bytes32' },
          { name: 'index', type: 'uint32' },
          { name: 'amount', type: 'uint128' },
          { name: 'address', type: 'bytes32' }
        ],
        Output: [
          { name: 'amount', type: 'uint128' },
          { name: 'address', type: 'bytes32' }
        ]
      };
      const primaryType = 'OmniverseUTXO';
      const domain = {
        // This defines the network, in this case, Mainnet.
        chainId: 1,
        // Give a user-friendly name to the specific contract you're signing for.
        name: 'Omniverse Transaction',
        // Add a verifying contract to make sure you're establishing contracts with the proper entity.
        verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
        // This identifies the latest version.
        version: '1',
      };
      const message = {
        tx_type: 'Transfer',
        detail: {
          asset_id: '0x1122334455667788112233445566778811223344556677881122334455667788',
          inputs: [{
            txid: "0x1122334455667788112233445566778811223344556677881122334455667788",
            index: "287454020",
            amount: "1234605616436508552",
            address: "0x1122334455667788112233445566778811223344556677881122334455667788"
          }],
          outputs: [{
            address: "0x1122334455667788112233445566778811223344556677881122334455667788",
            amount: "1234605616436508552"
          }],
          fee_inputs: [{
            txid: "0x1122334455667788112233445566778811223344556677881122334455667788",
            index: "287454020",
            amount: "1234605616436508552",
            address: "0x1122334455667788112233445566778811223344556677881122334455667788"
          }],
          fee_outputs: [{
            address: "0x1122334455667788112233445566778811223344556677881122334455667788",
            amount: "1234605616436508552"
          }]
        }
      };

      console.log('Transfer hash',
        TypedDataUtils.eip712Hash(
          {
            types,
            primaryType,
            domain,
            message,
          },
          SignTypedDataVersion.V4,
        ));
    });

    it('should hash data with a recursive data type', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
          { name: 'replyTo', type: 'Mail' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: 'Hello, Bob!',
        replyTo: {
          to: {
            name: 'Cow',
            wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
          },
          from: {
            name: 'Bob',
            wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
          },
          contents: 'Hello!',
        },
      };

      expect(
        TypedDataUtils.hashStruct(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V3,
        ).toString('hex'),
      ).toMatchSnapshot();
    });

    it('should throw an error when trying to hash a custom type array', function () {
      const types = {
        Message: [{ name: 'data', type: 'string[]' }],
      };
      const message = { data: ['1', '2', '3'] };

      expect(() =>
        TypedDataUtils.hashStruct(
          'Message',
          message,
          types,
          SignTypedDataVersion.V3,
        ).toString('hex'),
      ).toThrow('Arrays are unimplemented in encodeData; use V4 extension');
    });

    it('should ignore extra unspecified message properties', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: 'Hello, Bob!',
      };

      const originalSignature = TypedDataUtils.hashStruct(
        primaryType,
        message,
        types,
        SignTypedDataVersion.V3,
      ).toString('hex');
      const messageWithExtraProperties = { ...message, foo: 'bar' };
      const signatureWithExtraProperties = TypedDataUtils.hashStruct(
        primaryType,
        messageWithExtraProperties,
        types,
        SignTypedDataVersion.V3,
      ).toString('hex');

      expect(originalSignature).toBe(signatureWithExtraProperties);
    });

    it('should throw an error when an atomic property is set to null', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
          { name: 'length', type: 'int32' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: 'Hello!',
        length: null,
      };

      expect(() =>
        TypedDataUtils.hashStruct(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V3,
        ).toString('hex'),
      ).toThrow(
        'Unable to encode value: Invalid number. Expected a valid number value, but received "null".',
      );
    });

    it('should hash data with an atomic property set to undefined', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
          { name: 'length', type: 'int32' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: 'Hello!',
        length: undefined,
      };

      expect(
        TypedDataUtils.hashStruct(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V3,
        ).toString('hex'),
      ).toMatchSnapshot();
    });

    it('should hash data with a dynamic property set to null', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: null,
      };

      expect(
        TypedDataUtils.hashStruct(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V3,
        ).toString('hex'),
      ).toMatchSnapshot();
    });

    it('should hash data with a dynamic property set to undefined', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: undefined,
      };

      expect(
        TypedDataUtils.hashStruct(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V3,
        ).toString('hex'),
      ).toMatchSnapshot();
    });

    it('should throw an error when a custom type property is set to null', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        to: null,
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        contents: 'Hello, Bob!',
      };

      expect(() =>
        TypedDataUtils.hashStruct(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V3,
        ).toString('hex'),
      ).toThrow(/^Cannot read prop.+ null/u);
    });

    it('should hash data with a custom type property set to undefined', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: undefined,
        contents: 'Hello, Bob!',
      };

      expect(
        TypedDataUtils.hashStruct(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V3,
        ).toString('hex'),
      ).toMatchSnapshot();
    });

    it('should throw an error when trying to hash a function', function () {
      const types = {
        Message: [{ name: 'data', type: 'function' }],
      };
      const message = { data: 'test' };

      expect(() =>
        TypedDataUtils.hashStruct(
          'Message',
          message,
          types,
          SignTypedDataVersion.V3,
        ).toString('hex'),
      ).toThrow('Unsupported or invalid type: "function"');
    });

    it('should throw an error when trying to hash with a missing primary type definition', function () {
      const types = {};
      const message = { data: 'test' };

      expect(() =>
        TypedDataUtils.hashStruct(
          'Message',
          message,
          types,
          SignTypedDataVersion.V3,
        ).toString('hex'),
      ).toThrow('No type definition specified: Message');
    });

    it('should throw an error when trying to hash an unrecognized type', function () {
      const types = {
        Message: [{ name: 'data', type: 'foo' }],
      };
      const message = { data: 'test' };

      expect(() =>
        TypedDataUtils.hashStruct(
          'Message',
          message,
          types,
          SignTypedDataVersion.V3,
        ).toString('hex'),
      ).toThrow('Unable to encode value: The type "foo" is not supported.');
    });

    it('should hash data when given extraneous types', function () {
      const types = {
        Message: [{ name: 'data', type: 'string' }],
        Extra: [{ name: 'data', type: 'string' }],
      };
      const message = { data: 'Hello!' };

      expect(
        TypedDataUtils.hashStruct(
          'Message',
          message,
          types,
          SignTypedDataVersion.V3,
        ).toString('hex'),
      ).toMatchSnapshot();
    });

    it('should hash data when called unbound', function () {
      const types = {
        Message: [{ name: 'data', type: 'string' }],
      };
      const message = { data: 'Hello!' };
      const primaryType = 'Message';
      const { hashStruct } = TypedDataUtils;

      expect(
        hashStruct(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V3,
        ).toString('hex'),
      ).toMatchSnapshot();
    });
  });

  describe('V4', function () {
    describe('example data', function () {
      for (const type of allExampleTypes) {
        describe(`type "${type}"`, function () {
          // Test all examples that do not crash
          const inputs = encodeDataExamples[type] || [];
          for (const input of inputs) {
            const inputType = input instanceof Buffer ? 'Buffer' : typeof input;
            it(`should hash "${input}" (type "${inputType}")`, function () {
              const types = {
                Message: [{ name: 'data', type }],
              };
              const message = { data: input };

              expect(
                TypedDataUtils.hashStruct(
                  'Message',
                  message,
                  types,
                  SignTypedDataVersion.V4,
                ).toString('hex'),
              ).toMatchSnapshot();
            });
          }

          // Test all examples that crash
          const errorInputs = encodeDataErrorExamples[type] || [];
          for (const { input, errorMessage } of errorInputs) {
            const inputType = input instanceof Buffer ? 'Buffer' : typeof input;
            it(`should fail to hash "${input}" (type "${inputType}")`, function () {
              const types = {
                Message: [{ name: 'data', type }],
              };
              const message = { data: input };

              expect(() =>
                TypedDataUtils.hashStruct(
                  'Message',
                  message,
                  types,
                  SignTypedDataVersion.V4,
                ).toString('hex'),
              ).toThrow(errorMessage);
            });
          }

          it(`should hash array of all ${type} example data`, function () {
            const types = {
              Message: [{ name: 'data', type: `${type}[]` }],
            };
            const message = { data: inputs };
            expect(
              TypedDataUtils.hashStruct(
                'Message',
                message,
                types,
                SignTypedDataVersion.V4,
              ).toString('hex'),
            ).toMatchSnapshot();
          });
        });
      }
    });

    it('should hash data with custom type', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: 'Hello, Bob!',
      };

      expect(
        TypedDataUtils.hashStruct(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V4,
        ).toString('hex'),
      ).toMatchSnapshot();
    });

    it('should hash data with a recursive data type', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
          { name: 'replyTo', type: 'Mail' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: 'Hello, Bob!',
        replyTo: {
          to: {
            name: 'Cow',
            wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
          },
          from: {
            name: 'Bob',
            wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
          },
          contents: 'Hello!',
        },
      };

      expect(
        TypedDataUtils.hashStruct(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V4,
        ).toString('hex'),
      ).toMatchSnapshot();
    });

    it('should hash data with a custom data type array', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address[]' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person[]' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: [
            '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
            '0xDD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
          ],
        },
        to: [
          {
            name: 'Bob',
            wallet: ['0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB'],
          },
        ],
        contents: 'Hello, Bob!',
      };

      expect(
        TypedDataUtils.hashStruct(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V4,
        ).toString('hex'),
      ).toMatchSnapshot();
    });

    it('should ignore extra unspecified message properties', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: 'Hello, Bob!',
      };

      const originalSignature = TypedDataUtils.hashStruct(
        primaryType,
        message,
        types,
        SignTypedDataVersion.V4,
      ).toString('hex');
      const messageWithExtraProperties = { ...message, foo: 'bar' };
      const signatureWithExtraProperties = TypedDataUtils.hashStruct(
        primaryType,
        messageWithExtraProperties,
        types,
        SignTypedDataVersion.V4,
      ).toString('hex');

      expect(originalSignature).toBe(signatureWithExtraProperties);
    });

    it('should throw an error when an atomic property is set to null', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
          { name: 'length', type: 'int32' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: 'Hello!',
        length: null,
      };

      expect(() =>
        TypedDataUtils.hashStruct(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V4,
        ).toString('hex'),
      ).toThrow(
        'Unable to encode value: Invalid number. Expected a valid number value, but received "null".',
      );
    });

    it('should throw an error when an atomic property is set to undefined', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
          { name: 'length', type: 'int32' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: 'Hello!',
        length: undefined,
      };

      expect(() =>
        TypedDataUtils.hashStruct(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V4,
        ).toString('hex'),
      ).toThrow('missing value for field length of type int32');
    });

    it('should hash data with a dynamic property set to null', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: null,
      };

      expect(
        TypedDataUtils.hashStruct(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V4,
        ).toString('hex'),
      ).toMatchSnapshot();
    });

    it('should throw an error when a dynamic property is set to undefined', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: undefined,
      };

      expect(() =>
        TypedDataUtils.hashStruct(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V4,
        ).toString('hex'),
      ).toThrow('missing value for field contents of type string');
    });

    it('should hash data with a custom type property set to null', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        to: null,
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        contents: 'Hello, Bob!',
      };

      expect(
        TypedDataUtils.hashStruct(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V4,
        ).toString('hex'),
      ).toMatchSnapshot();
    });

    it('should hash data with a custom type property set to undefined', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: undefined,
        contents: 'Hello, Bob!',
      };

      expect(
        TypedDataUtils.hashStruct(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V4,
        ).toString('hex'),
      ).toMatchSnapshot();
    });

    it('should throw an error when trying to hash a function', function () {
      const types = {
        Message: [{ name: 'data', type: 'function' }],
      };
      const message = { data: 'test' };

      expect(() =>
        TypedDataUtils.hashStruct(
          'Message',
          message,
          types,
          SignTypedDataVersion.V4,
        ).toString('hex'),
      ).toThrow('Unsupported or invalid type: "function"');
    });

    it('should throw an error when trying to hash with a missing primary type definition', function () {
      const types = {};
      const message = { data: 'test' };

      expect(() =>
        TypedDataUtils.hashStruct(
          'Message',
          message,
          types,
          SignTypedDataVersion.V4,
        ).toString('hex'),
      ).toThrow('No type definition specified: Message');
    });

    it('should throw an error when trying to hash an unrecognized type', function () {
      const types = {
        Message: [{ name: 'data', type: 'foo' }],
      };
      const message = { data: 'test' };

      expect(() =>
        TypedDataUtils.hashStruct(
          'Message',
          message,
          types,
          SignTypedDataVersion.V4,
        ).toString('hex'),
      ).toThrow('Unable to encode value: The type "foo" is not supported.');
    });

    it('should hash data when given extraneous types', function () {
      const types = {
        Message: [{ name: 'data', type: 'string' }],
        Extra: [{ name: 'data', type: 'string' }],
      };
      const message = { data: 'Hello!' };

      expect(
        TypedDataUtils.hashStruct(
          'Message',
          message,
          types,
          SignTypedDataVersion.V4,
        ).toString('hex'),
      ).toMatchSnapshot();
    });

    it('should hash data when called unbound', function () {
      const types = {
        Message: [{ name: 'data', type: 'string' }],
      };
      const message = { data: 'Hello!' };
      const primaryType = 'Message';
      const { hashStruct } = TypedDataUtils;

      expect(
        hashStruct(
          primaryType,
          message,
          types,
          SignTypedDataVersion.V4,
        ).toString('hex'),
      ).toMatchSnapshot();
    });
  });

  // This test suite covers all cases where data should be encoded identically
  // on V3 and V4
  describe('V3/V4 identical encodings', function () {
    describe('example data', function () {
      for (const type of allExampleTypes) {
        describe(`type "${type}"`, function () {
          // Test all examples that do not crash
          const inputs = encodeDataExamples[type] || [];
          for (const input of inputs) {
            const inputType = input instanceof Buffer ? 'Buffer' : typeof input;
            it(`should hash "${input}" (type "${inputType}")`, function () {
              const types = {
                Message: [{ name: 'data', type }],
              };
              const message = { data: input };

              const v3Signature = TypedDataUtils.hashStruct(
                'Message',
                message,
                types,
                SignTypedDataVersion.V3,
              ).toString('hex');
              const v4Signature = TypedDataUtils.hashStruct(
                'Message',
                message,
                types,
                SignTypedDataVersion.V4,
              ).toString('hex');

              expect(v3Signature).toBe(v4Signature);
            });
          }
        });
      }
    });

    it('should hash data with custom type', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: 'Hello, Bob!',
      };

      const v3Signature = TypedDataUtils.hashStruct(
        primaryType,
        message,
        types,
        SignTypedDataVersion.V3,
      ).toString('hex');
      const v4Signature = TypedDataUtils.hashStruct(
        primaryType,
        message,
        types,
        SignTypedDataVersion.V4,
      ).toString('hex');

      expect(v3Signature).toBe(v4Signature);
    });

    it('should ignore extra unspecified message properties', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: 'Hello, Bob!',
      };

      const originalV3Signature = TypedDataUtils.hashStruct(
        primaryType,
        message,
        types,
        SignTypedDataVersion.V3,
      ).toString('hex');
      const originalV4Signature = TypedDataUtils.hashStruct(
        primaryType,
        message,
        types,
        SignTypedDataVersion.V4,
      ).toString('hex');
      const messageWithExtraProperties = { ...message, foo: 'bar' };
      const v3signatureWithExtraProperties = TypedDataUtils.hashStruct(
        primaryType,
        messageWithExtraProperties,
        types,
        SignTypedDataVersion.V3,
      ).toString('hex');
      const v4signatureWithExtraProperties = TypedDataUtils.hashStruct(
        primaryType,
        messageWithExtraProperties,
        types,
        SignTypedDataVersion.V4,
      ).toString('hex');

      expect(originalV3Signature).toBe(originalV4Signature);
      expect(v3signatureWithExtraProperties).toBe(
        v4signatureWithExtraProperties,
      );
    });

    it('should hash data with a dynamic property set to null', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: null,
      };

      const v3Signature = TypedDataUtils.hashStruct(
        primaryType,
        message,
        types,
        SignTypedDataVersion.V3,
      ).toString('hex');
      const v4Signature = TypedDataUtils.hashStruct(
        primaryType,
        message,
        types,
        SignTypedDataVersion.V4,
      ).toString('hex');

      expect(v3Signature).toBe(v4Signature);
    });

    it('should hash data when given extraneous types', function () {
      const types = {
        Message: [{ name: 'data', type: 'string' }],
        Extra: [{ name: 'data', type: 'string' }],
      };
      const message = { data: 'Hello!' };

      const v3Signature = TypedDataUtils.hashStruct(
        'Message',
        message,
        types,
        SignTypedDataVersion.V3,
      ).toString('hex');
      const v4Signature = TypedDataUtils.hashStruct(
        'Message',
        message,
        types,
        SignTypedDataVersion.V4,
      ).toString('hex');

      expect(v3Signature).toBe(v4Signature);
    });
  });

  // This test suite covers all cases where data should be encoded differently
  // on V3 and V4
  describe('V3/V4 encoding differences', () => {
    // Recursive data structures are encoded differently because V4 encodes
    // missing custom typed properties as 0 byte32 rather than omitting it,
    // and all recursive data structures must include a missing custom typed
    // property (the recursive one), or they'd be infinitely large or cyclic.
    // And cyclic data structures are not supported.
    it('should hash data with recursive data differently', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
          { name: 'replyTo', type: 'Mail' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: 'Hello, Bob!',
        replyTo: {
          to: {
            name: 'Cow',
            wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
          },
          from: {
            name: 'Bob',
            wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
          },
          contents: 'Hello!',
        },
      };

      const v3Signature = TypedDataUtils.hashStruct(
        primaryType,
        message,
        types,
        SignTypedDataVersion.V3,
      ).toString('hex');
      const v4Signature = TypedDataUtils.hashStruct(
        primaryType,
        message,
        types,
        SignTypedDataVersion.V4,
      ).toString('hex');

      expect(v3Signature).not.toBe(v4Signature);
    });

    // Missing custom type properties are omitted in V3, but encoded as 0 (bytes32) in V4
    it('should hash missing custom type properties differently', function () {
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        contents: 'Hello, Bob!',
      };

      const v3Signature = TypedDataUtils.hashStruct(
        primaryType,
        message,
        types,
        SignTypedDataVersion.V3,
      ).toString('hex');
      const v4Signature = TypedDataUtils.hashStruct(
        primaryType,
        message,
        types,
        SignTypedDataVersion.V4,
      ).toString('hex');

      expect(v3Signature).not.toBe(v4Signature);
    });
  });

  it('should throw if passed an invalid version', () => {
    const types = {
      Message: [{ name: 'data', type: 'string' }],
    };
    const message = { data: 'Hello!' };
    expect(() =>
      TypedDataUtils.hashStruct(
        'Message',
        message,
        types,
        'V0' as any,
      ).toString('hex'),
    ).toThrow('Invalid version');
  });

  it('should throw if passed a version that is not allowed', () => {
    const types = {
      Message: [{ name: 'data', type: 'string' }],
    };
    const message = { data: 'Hello!' };
    expect(() =>
      TypedDataUtils.hashStruct(
        'Message',
        message,
        types,
        SignTypedDataVersion.V1 as any,
      ).toString('hex'),
    ).toThrow('SignTypedDataVersion not allowed');
  });
});

describe('TypedDataUtils.encodeType', () => {
  // Note that these tests should mirror the `TypedDataUtils.hashType` tests. The `hashType`
  // function just calls `encodeType` and hashes the result.
  it('should encode simple type', () => {
    const types = {
      Person: [{ name: 'name', type: 'string' }],
    };
    const primaryType = 'Person';

    expect(TypedDataUtils.encodeType(primaryType, types)).toMatchInlineSnapshot(
      `"Person(string name)"`,
    );
  });

  it('should encode complex type', () => {
    const types = {
      Person: [
        { name: 'name', type: 'string' },
        { name: 'wallet', type: 'address' },
      ],
      Mail: [
        { name: 'from', type: 'Person' },
        { name: 'to', type: 'Person[]' },
        { name: 'contents', type: 'string' },
      ],
    };
    const primaryType = 'Mail';

    expect(TypedDataUtils.encodeType(primaryType, types)).toMatchInlineSnapshot(
      `"Mail(Person from,Person[] to,string contents)Person(string name,address wallet)"`,
    );
  });

  it('should encode recursive type', () => {
    const types = {
      Person: [
        { name: 'name', type: 'string' },
        { name: 'wallet', type: 'address' },
      ],
      Mail: [
        { name: 'from', type: 'Person' },
        { name: 'to', type: 'Person' },
        { name: 'contents', type: 'string' },
        { name: 'replyTo', type: 'Mail' },
      ],
    };
    const primaryType = 'Mail';

    expect(TypedDataUtils.encodeType(primaryType, types)).toMatchInlineSnapshot(
      `"Mail(Person from,Person to,string contents,Mail replyTo)Person(string name,address wallet)"`,
    );
  });

  it('should encode unrecognized non-primary types', () => {
    const types = {
      Mail: [
        { name: 'from', type: 'Person' },
        { name: 'to', type: 'Person' },
        { name: 'contents', type: 'string' },
      ],
    };
    const primaryType = 'Mail';

    expect(TypedDataUtils.encodeType(primaryType, types)).toMatchInlineSnapshot(
      `"Mail(Person from,Person to,string contents)"`,
    );
  });

  it('should throw if primary type is missing', () => {
    const types = {
      Person: [
        { name: 'name', type: 'string' },
        { name: 'wallet', type: 'address' },
      ],
    };
    const primaryType = 'Mail';

    expect(() => TypedDataUtils.encodeType(primaryType, types)).toThrow(
      'No type definition specified: Mail',
    );
  });

  it('should encode type when called unbound', function () {
    const types = {
      Message: [{ name: 'data', type: 'string' }],
    };
    const primaryType = 'Message';
    const { encodeType } = TypedDataUtils;

    expect(encodeType(primaryType, types)).toMatchInlineSnapshot(
      `"Message(string data)"`,
    );
  });
});

describe('TypedDataUtils.hashType', () => {
  // These tests mirror the `TypedDataUtils.encodeType` tests. The same inputs are expected.
  it('should hash simple type', () => {
    const types = {
      Person: [{ name: 'name', type: 'string' }],
    };
    const primaryType = 'Person';

    expect(
      TypedDataUtils.hashType(primaryType, types).toString('hex'),
    ).toMatchInlineSnapshot(
      `"fcbb73369ebb221abfdc626fdec0be9ca48ad89ef757b9a76eb7b31ddd261338"`,
    );
  });

  it('should hash complex type', () => {
    const types = {
      Person: [
        { name: 'name', type: 'string' },
        { name: 'wallet', type: 'address' },
      ],
      Mail: [
        { name: 'from', type: 'Person' },
        { name: 'to', type: 'Person[]' },
        { name: 'contents', type: 'string' },
      ],
    };
    const primaryType = 'Mail';

    expect(
      TypedDataUtils.hashType(primaryType, types).toString('hex'),
    ).toMatchInlineSnapshot(
      `"dd57d9596af52b430ced3d5b52d4e3d5dccfdf3e0572db1dcf526baad311fbd1"`,
    );
  });

  it('should hash recursive type', () => {
    const types = {
      Person: [
        { name: 'name', type: 'string' },
        { name: 'wallet', type: 'address' },
      ],
      Mail: [
        { name: 'from', type: 'Person' },
        { name: 'to', type: 'Person' },
        { name: 'contents', type: 'string' },
        { name: 'replyTo', type: 'Mail' },
      ],
    };
    const primaryType = 'Mail';

    expect(
      TypedDataUtils.hashType(primaryType, types).toString('hex'),
    ).toMatchInlineSnapshot(
      `"66658e9662034bcd21df657297dab8ba47f0ae05dd8aa253cc935d9aacfd9d10"`,
    );
  });

  it('should hash unrecognized non-primary types', () => {
    const types = {
      Mail: [
        { name: 'from', type: 'Person' },
        { name: 'to', type: 'Person' },
        { name: 'contents', type: 'string' },
      ],
    };
    const primaryType = 'Mail';

    expect(
      TypedDataUtils.hashType(primaryType, types).toString('hex'),
    ).toMatchInlineSnapshot(
      `"c0aee50a43b64ca632347f993c5a39cbddcae6ae329a7a111357622dc88dc1fb"`,
    );
  });

  it('should throw if primary type is missing', () => {
    const types = {
      Person: [
        { name: 'name', type: 'string' },
        { name: 'wallet', type: 'address' },
      ],
    };
    const primaryType = 'Mail';

    expect(() =>
      TypedDataUtils.hashType(primaryType, types).toString('hex'),
    ).toThrow('No type definition specified: Mail');
  });

  it('should hash type when called unbound', function () {
    const types = {
      Message: [{ name: 'data', type: 'string' }],
    };
    const primaryType = 'Message';
    const { hashType } = TypedDataUtils;

    expect(hashType(primaryType, types).toString('hex')).toMatchInlineSnapshot(
      `"cddf41b07426e1a761f3da57e35474ae3deaa5b596306531f651c6dc1321e4fd"`,
    );
  });
});

describe('TypedDataUtils.findTypeDependencies', () => {
  it('should return type dependencies of a simple type', function () {
    const types = {
      Person: [{ name: 'name', type: 'string' }],
    };
    const primaryType = 'Person';

    expect(
      TypedDataUtils.findTypeDependencies(primaryType, types),
    ).toStrictEqual(new Set(['Person']));
  });

  it('should return type dependencies of an array type', function () {
    const types = {
      Person: [{ name: 'name', type: 'string' }],
    };
    const primaryType = 'Person[]';

    expect(
      TypedDataUtils.findTypeDependencies(primaryType, types),
    ).toStrictEqual(new Set(['Person']));
  });

  it('should return type dependencies of a complex type', function () {
    const types = {
      Person: [
        { name: 'name', type: 'string' },
        { name: 'wallet', type: 'address' },
      ],
      Mail: [
        { name: 'from', type: 'Person' },
        { name: 'to', type: 'Person[]' },
        { name: 'contents', type: 'string' },
      ],
    };
    const primaryType = 'Mail';

    expect(
      TypedDataUtils.findTypeDependencies(primaryType, types),
    ).toStrictEqual(new Set(['Mail', 'Person']));
  });

  it('should return type dependencies of a recursive type', function () {
    const types = {
      Person: [
        { name: 'name', type: 'string' },
        { name: 'wallet', type: 'address' },
      ],
      Mail: [
        { name: 'from', type: 'Person' },
        { name: 'to', type: 'Person[]' },
        { name: 'contents', type: 'string' },
        { name: 'replyTo', type: 'Mail' },
      ],
    };
    const primaryType = 'Mail';

    expect(
      TypedDataUtils.findTypeDependencies(primaryType, types),
    ).toStrictEqual(new Set(['Mail', 'Person']));
  });

  it('should return empty set if primary type is missing', function () {
    const primaryType = 'Person';

    expect(TypedDataUtils.findTypeDependencies(primaryType, {})).toStrictEqual(
      new Set(),
    );
  });

  it('should return type dependencies when called unbound', function () {
    const types = {
      Person: [{ name: 'name', type: 'string' }],
    };
    const primaryType = 'Person';
    const { findTypeDependencies } = TypedDataUtils;

    expect(findTypeDependencies(primaryType, types)).toStrictEqual(
      new Set(['Person']),
    );
  });

  it('should throw when called with null input', function () {
    const primaryType = null;

    expect(() => {
      TypedDataUtils.findTypeDependencies(primaryType as any as string, {});
    }).toThrow('Invalid findTypeDependencies input null');
  });

  it('should throw when called with undefined input', function () {
    const primaryType = undefined;

    expect(() => {
      TypedDataUtils.findTypeDependencies(primaryType as any as string, {});
    }).toThrow('Invalid findTypeDependencies input undefined');
  });
});

describe('TypedDataUtils.sanitizeData', function () {
  it('should return correctly formatted data unchanged', function () {
    const typedMessage = {
      domain: {},
      message: {},
      primaryType: 'Person' as const,
      types: {
        EIP712Domain: [{ name: 'name', type: 'string' }],
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
      },
    };

    const sanitizedTypedMessage = TypedDataUtils.sanitizeData(typedMessage);

    expect(sanitizedTypedMessage).toStrictEqual(typedMessage);
  });

  it("should add `EIP712Domain` to `types` if it's missing", function () {
    const typedMessage = {
      domain: {},
      message: {},
      primaryType: 'Person' as const,
      types: {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
      },
    };

    const sanitizedTypedMessage = TypedDataUtils.sanitizeData(
      typedMessage as any,
    );

    expect(sanitizedTypedMessage).toStrictEqual({
      ...typedMessage,
      types: { ...typedMessage.types, EIP712Domain: [] },
    });
  });

  it('should sanitize empty object', function () {
    const typedMessage = {};

    const sanitizedTypedMessage = TypedDataUtils.sanitizeData(
      typedMessage as any,
    );

    expect(sanitizedTypedMessage).toStrictEqual({});
  });

  it('should omit unrecognized properties', function () {
    const expectedMessage = {
      domain: {},
      message: {},
      primaryType: 'Person' as const,
      types: {
        EIP712Domain: [{ name: 'name', type: 'string' }],
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
      },
    };
    const typedMessage = { ...expectedMessage, extraStuff: 'Extra stuff' };

    const sanitizedTypedMessage = TypedDataUtils.sanitizeData(typedMessage);

    expect(sanitizedTypedMessage).toStrictEqual(expectedMessage);
  });

  it('should sanitize data when called unbound', function () {
    const typedMessage = {
      domain: {},
      message: {},
      primaryType: 'Person' as const,
      types: {
        EIP712Domain: [{ name: 'name', type: 'string' }],
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
      },
    };
    const { sanitizeData } = TypedDataUtils;

    const sanitizedTypedMessage = sanitizeData(typedMessage);

    expect(sanitizedTypedMessage).toStrictEqual(typedMessage);
  });
});

describe('TypedDataUtils.eip712Hash', function () {
  describe('V3', function () {
    it('should hash a minimal valid typed message', function () {
      const hash = TypedDataUtils.eip712Hash(
        // This represents the most basic "typed message" that is valid according to our types.
        // It's not a very useful message (it's totally empty), but it's complete according to the
        // spec.
        {
          types: {
            EIP712Domain: [],
          },
          primaryType: 'EIP712Domain',
          domain: {},
          message: {},
        },
        SignTypedDataVersion.V3,
      );

      expect(hash.toString('hex')).toMatchSnapshot();
    });

    it('minimal typed message hash should be identical to minimal valid typed message hash', function () {
      const minimalHash = TypedDataUtils.eip712Hash(
        // This tests that when the mandatory fields `domain`, `message`, and `types.EIP712Domain`
        // are omitted, the result is the same as if they were included but empty.
        {
          types: {},
          primaryType: 'EIP712Domain',
        } as any,
        SignTypedDataVersion.V3,
      );
      const minimalValidHash = TypedDataUtils.eip712Hash(
        {
          types: {
            EIP712Domain: [],
          },
          primaryType: 'EIP712Domain',
          domain: {},
          message: {},
        },
        SignTypedDataVersion.V3,
      );

      expect(minimalHash.toString('hex')).toBe(
        minimalValidHash.toString('hex'),
      );
    });

    it('should ignore extra top-level properties', function () {
      const minimalValidHash = TypedDataUtils.eip712Hash(
        {
          types: {
            EIP712Domain: [],
          },
          primaryType: 'EIP712Domain',
          domain: {},
          message: {},
        },
        SignTypedDataVersion.V3,
      );
      const extraPropertiesHash = TypedDataUtils.eip712Hash(
        {
          types: {
            EIP712Domain: [],
          },
          primaryType: 'EIP712Domain',
          domain: {},
          message: {},
          extra: 'stuff',
          moreExtra: 1,
        } as any,
        SignTypedDataVersion.V3,
      );

      expect(minimalValidHash.toString('hex')).toBe(
        extraPropertiesHash.toString('hex'),
      );
    });

    it('should hash a typed message with a domain separator that uses all fields', function () {
      const hash = TypedDataUtils.eip712Hash(
        {
          types: {
            EIP712Domain: [
              {
                name: 'name',
                type: 'string',
              },
              {
                name: 'version',
                type: 'string',
              },
              {
                name: 'chainId',
                type: 'uint256',
              },
              {
                name: 'verifyingContract',
                type: 'address',
              },
              {
                name: 'salt',
                type: 'bytes32',
              },
            ],
          },
          primaryType: 'EIP712Domain',
          domain: {
            name: 'example.metamask.io',
            version: '1',
            chainId: 1,
            verifyingContract: '0x0000000000000000000000000000000000000000',
            salt: Buffer.from(new Int32Array([1, 2, 3])),
          },
          message: {},
        },
        SignTypedDataVersion.V3,
      );

      expect(hash.toString('hex')).toMatchSnapshot();
    });

    it('should hash a typed message with extra domain seperator fields', function () {
      const hash = TypedDataUtils.eip712Hash(
        {
          types: {
            EIP712Domain: [
              {
                name: 'name',
                type: 'string',
              },
              {
                name: 'version',
                type: 'string',
              },
              {
                name: 'chainId',
                type: 'uint256',
              },
              {
                name: 'verifyingContract',
                type: 'address',
              },
              {
                name: 'salt',
                type: 'bytes32',
              },
              {
                name: 'extraField',
                type: 'string',
              },
            ],
          },
          primaryType: 'EIP712Domain',
          domain: {
            name: 'example.metamask.io',
            version: '1',
            chainId: 1,
            verifyingContract: '0x0000000000000000000000000000000000000000',
            salt: Buffer.from(new Int32Array([1, 2, 3])),
            extraField: 'stuff',
          },
          message: {},
        } as any,
        SignTypedDataVersion.V3,
      );

      expect(hash.toString('hex')).toMatchSnapshot();
    });

    it('should hash a typed message with only custom domain seperator fields', function () {
      const hash = TypedDataUtils.eip712Hash(
        {
          types: {
            EIP712Domain: [
              {
                name: 'customName',
                type: 'string',
              },
              {
                name: 'customVersion',
                type: 'string',
              },
              {
                name: 'customChainId',
                type: 'uint256',
              },
              {
                name: 'customVerifyingContract',
                type: 'address',
              },
              {
                name: 'customSalt',
                type: 'bytes32',
              },
              {
                name: 'extraField',
                type: 'string',
              },
            ],
          },
          primaryType: 'EIP712Domain',
          domain: {
            customName: 'example.metamask.io',
            customVersion: '1',
            customChainId: 1,
            customVerifyingContract:
              '0x0000000000000000000000000000000000000000',
            customSalt: Buffer.from(new Int32Array([1, 2, 3])),
            extraField: 'stuff',
          },
          message: {},
        } as any,
        SignTypedDataVersion.V3,
      );

      expect(hash.toString('hex')).toMatchSnapshot();
    });

    it('should hash a typed message with data', function () {
      const hash = TypedDataUtils.eip712Hash(
        {
          types: {
            EIP712Domain: [
              {
                name: 'name',
                type: 'string',
              },
              {
                name: 'version',
                type: 'string',
              },
              {
                name: 'chainId',
                type: 'uint256',
              },
              {
                name: 'verifyingContract',
                type: 'address',
              },
              {
                name: 'salt',
                type: 'bytes32',
              },
            ],
            Message: [{ name: 'data', type: 'string' }],
          },
          primaryType: 'Message',
          domain: {
            name: 'example.metamask.io',
            version: '1',
            chainId: 1,
            verifyingContract: '0x0000000000000000000000000000000000000000',
            salt: Buffer.from(new Int32Array([1, 2, 3])),
          },
          message: {
            data: 'Hello!',
          },
        },
        SignTypedDataVersion.V3,
      );

      expect(hash.toString('hex')).toMatchSnapshot();
    });

    it('should ignore message if the primary type is EIP712Domain', function () {
      const hashWithMessage = TypedDataUtils.eip712Hash(
        {
          types: {
            EIP712Domain: [
              {
                name: 'name',
                type: 'string',
              },
              {
                name: 'version',
                type: 'string',
              },
              {
                name: 'chainId',
                type: 'uint256',
              },
              {
                name: 'verifyingContract',
                type: 'address',
              },
              {
                name: 'salt',
                type: 'bytes32',
              },
            ],
            Message: [{ name: 'data', type: 'string' }],
          },
          primaryType: 'EIP712Domain',
          domain: {
            name: 'example.metamask.io',
            version: '1',
            chainId: 1,
            verifyingContract: '0x0000000000000000000000000000000000000000',
            salt: Buffer.from(new Int32Array([1, 2, 3])),
          },
          message: {
            data: 'Hello!',
          },
        },
        SignTypedDataVersion.V3,
      );
      const hashWithoutMessage = TypedDataUtils.eip712Hash(
        {
          types: {
            EIP712Domain: [
              {
                name: 'name',
                type: 'string',
              },
              {
                name: 'version',
                type: 'string',
              },
              {
                name: 'chainId',
                type: 'uint256',
              },
              {
                name: 'verifyingContract',
                type: 'address',
              },
              {
                name: 'salt',
                type: 'bytes32',
              },
            ],
            Message: [{ name: 'data', type: 'string' }],
          },
          primaryType: 'EIP712Domain',
          domain: {
            name: 'example.metamask.io',
            version: '1',
            chainId: 1,
            verifyingContract: '0x0000000000000000000000000000000000000000',
            salt: Buffer.from(new Int32Array([1, 2, 3])),
          },
          message: {},
        },
        SignTypedDataVersion.V3,
      );

      expect(hashWithMessage.toString('hex')).toBe(
        hashWithoutMessage.toString('hex'),
      );
    });

    it('should hash a minimal valid typed message when called unbound', function () {
      const { eip712Hash } = TypedDataUtils;

      const hash = eip712Hash(
        // This represents the most basic "typed message" that is valid according to our types.
        // It's not a very useful message (it's totally empty), but it's complete according to the
        // spec.
        {
          types: {
            EIP712Domain: [],
          },
          primaryType: 'EIP712Domain',
          domain: {},
          message: {},
        },
        SignTypedDataVersion.V3,
      );

      expect(hash.toString('hex')).toMatchSnapshot();
    });
  });

  describe('V4', function () {
    it('should hash a minimal valid typed message', function () {
      // This represents the most basic "typed message" that is valid according to our types.
      // It's not a very useful message (it's totally empty), but it's complete according to the
      // spec.
      const hash = TypedDataUtils.eip712Hash(
        {
          types: {
            EIP712Domain: [],
          },
          primaryType: 'EIP712Domain',
          domain: {},
          message: {},
        },
        SignTypedDataVersion.V4,
      );

      expect(hash.toString('hex')).toMatchSnapshot();
    });

    it('minimal typed message hash should be identical to minimal valid typed message hash', function () {
      // This tests that when the mandatory fields `domain`, `message`, and `types.EIP712Domain`
      // are omitted, the result is the same as if they were included but empty.
      const minimalHash = TypedDataUtils.eip712Hash(
        {
          types: {},
          primaryType: 'EIP712Domain',
        } as any,
        SignTypedDataVersion.V4,
      );
      const minimalValidHash = TypedDataUtils.eip712Hash(
        {
          types: {
            EIP712Domain: [],
          },
          primaryType: 'EIP712Domain',
          domain: {},
          message: {},
        },
        SignTypedDataVersion.V4,
      );

      expect(minimalHash.toString('hex')).toBe(
        minimalValidHash.toString('hex'),
      );
    });

    it('should ignore extra top-level properties', function () {
      const minimalValidHash = TypedDataUtils.eip712Hash(
        {
          types: {
            EIP712Domain: [],
          },
          primaryType: 'EIP712Domain',
          domain: {},
          message: {},
        },
        SignTypedDataVersion.V4,
      );
      const extraPropertiesHash = TypedDataUtils.eip712Hash(
        {
          types: {
            EIP712Domain: [],
          },
          primaryType: 'EIP712Domain',
          domain: {},
          message: {},
          extra: 'stuff',
          moreExtra: 1,
        } as any,
        SignTypedDataVersion.V4,
      );

      expect(minimalValidHash.toString('hex')).toBe(
        extraPropertiesHash.toString('hex'),
      );
    });

    it('should hash a typed message with a domain separator that uses all fields.', function () {
      const hash = TypedDataUtils.eip712Hash(
        {
          types: {
            EIP712Domain: [
              {
                name: 'name',
                type: 'string',
              },
              {
                name: 'version',
                type: 'string',
              },
              {
                name: 'chainId',
                type: 'uint256',
              },
              {
                name: 'verifyingContract',
                type: 'address',
              },
              {
                name: 'salt',
                type: 'bytes32',
              },
            ],
          },
          primaryType: 'EIP712Domain',
          domain: {
            name: 'example.metamask.io',
            version: '1',
            chainId: 1,
            verifyingContract: '0x0000000000000000000000000000000000000000',
            salt: Buffer.from(new Int32Array([1, 2, 3])),
          },
          message: {},
        },
        SignTypedDataVersion.V4,
      );

      expect(hash.toString('hex')).toMatchSnapshot();
    });

    it('should hash a typed message with extra domain seperator fields', function () {
      const hash = TypedDataUtils.eip712Hash(
        {
          types: {
            EIP712Domain: [
              {
                name: 'name',
                type: 'string',
              },
              {
                name: 'version',
                type: 'string',
              },
              {
                name: 'chainId',
                type: 'uint256',
              },
              {
                name: 'verifyingContract',
                type: 'address',
              },
              {
                name: 'salt',
                type: 'bytes32',
              },
              {
                name: 'extraField',
                type: 'string',
              },
            ],
          },
          primaryType: 'EIP712Domain',
          domain: {
            name: 'example.metamask.io',
            version: '1',
            chainId: 1,
            verifyingContract: '0x0000000000000000000000000000000000000000',
            salt: Buffer.from(new Int32Array([1, 2, 3])),
            extraField: 'stuff',
          },
          message: {},
        } as any,
        SignTypedDataVersion.V4,
      );

      expect(hash.toString('hex')).toMatchSnapshot();
    });

    it('should hash a typed message with only custom domain seperator fields', function () {
      const hash = TypedDataUtils.eip712Hash(
        {
          types: {
            EIP712Domain: [
              {
                name: 'customName',
                type: 'string',
              },
              {
                name: 'customVersion',
                type: 'string',
              },
              {
                name: 'customChainId',
                type: 'uint256',
              },
              {
                name: 'customVerifyingContract',
                type: 'address',
              },
              {
                name: 'customSalt',
                type: 'bytes32',
              },
              {
                name: 'extraField',
                type: 'string',
              },
            ],
          },
          primaryType: 'EIP712Domain',
          domain: {
            customName: 'example.metamask.io',
            customVersion: '1',
            customChainId: 1,
            customVerifyingContract:
              '0x0000000000000000000000000000000000000000',
            customSalt: Buffer.from(new Int32Array([1, 2, 3])),
            extraField: 'stuff',
          },
          message: {},
        } as any,
        SignTypedDataVersion.V4,
      );

      expect(hash.toString('hex')).toMatchSnapshot();
    });

    it('should hash a typed message with data', function () {
      const hash = TypedDataUtils.eip712Hash(
        {
          types: {
            EIP712Domain: [
              {
                name: 'name',
                type: 'string',
              },
              {
                name: 'version',
                type: 'string',
              },
              {
                name: 'chainId',
                type: 'uint256',
              },
              {
                name: 'verifyingContract',
                type: 'address',
              },
              {
                name: 'salt',
                type: 'bytes32',
              },
            ],
            Message: [{ name: 'data', type: 'string' }],
          },
          primaryType: 'Message',
          domain: {
            name: 'example.metamask.io',
            version: '1',
            chainId: 1,
            verifyingContract: '0x0000000000000000000000000000000000000000',
            salt: Buffer.from(new Int32Array([1, 2, 3])),
          },
          message: {
            data: 'Hello!',
          },
        },
        SignTypedDataVersion.V4,
      );

      expect(hash.toString('hex')).toMatchSnapshot();
    });

    it('should ignore message if the primary type is EIP712Domain', function () {
      const hashWithMessage = TypedDataUtils.eip712Hash(
        {
          types: {
            EIP712Domain: [
              {
                name: 'name',
                type: 'string',
              },
              {
                name: 'version',
                type: 'string',
              },
              {
                name: 'chainId',
                type: 'uint256',
              },
              {
                name: 'verifyingContract',
                type: 'address',
              },
              {
                name: 'salt',
                type: 'bytes32',
              },
            ],
            Message: [{ name: 'data', type: 'string' }],
          },
          primaryType: 'EIP712Domain',
          domain: {
            name: 'example.metamask.io',
            version: '1',
            chainId: 1,
            verifyingContract: '0x0000000000000000000000000000000000000000',
            salt: Buffer.from(new Int32Array([1, 2, 3])),
          },
          message: {
            data: 'Hello!',
          },
        },
        SignTypedDataVersion.V4,
      );
      const hashWithoutMessage = TypedDataUtils.eip712Hash(
        {
          types: {
            EIP712Domain: [
              {
                name: 'name',
                type: 'string',
              },
              {
                name: 'version',
                type: 'string',
              },
              {
                name: 'chainId',
                type: 'uint256',
              },
              {
                name: 'verifyingContract',
                type: 'address',
              },
              {
                name: 'salt',
                type: 'bytes32',
              },
            ],
            Message: [{ name: 'data', type: 'string' }],
          },
          primaryType: 'EIP712Domain',
          domain: {
            name: 'example.metamask.io',
            version: '1',
            chainId: 1,
            verifyingContract: '0x0000000000000000000000000000000000000000',
            salt: Buffer.from(new Int32Array([1, 2, 3])),
          },
          message: {},
        },
        SignTypedDataVersion.V4,
      );

      expect(hashWithMessage.toString('hex')).toBe(
        hashWithoutMessage.toString('hex'),
      );
    });

    it('should hash a minimal valid typed message when called unbound', function () {
      const { eip712Hash } = TypedDataUtils;

      // This represents the most basic "typed message" that is valid according to our types.
      // It's not a very useful message (it's totally empty), but it's complete according to the
      // spec.
      const hash = eip712Hash(
        {
          types: {
            EIP712Domain: [],
          },
          primaryType: 'EIP712Domain',
          domain: {},
          message: {},
        },
        SignTypedDataVersion.V4,
      );

      expect(hash.toString('hex')).toMatchSnapshot();
    });
  });

  it('should throw if passed an invalid version', () => {
    expect(() =>
      TypedDataUtils.eip712Hash(
        {
          types: {
            EIP712Domain: [],
          },
          primaryType: 'EIP712Domain',
          domain: {},
          message: {},
        },
        'V0' as any,
      ),
    ).toThrow('Invalid version');
  });

  it('should throw if passed a version that is not allowed', () => {
    expect(() =>
      TypedDataUtils.eip712Hash(
        {
          types: {
            EIP712Domain: [],
          },
          primaryType: 'EIP712Domain',
          domain: {},
          message: {},
        },
        SignTypedDataVersion.V1 as any,
      ),
    ).toThrow('SignTypedDataVersion not allowed');
  });
});

// Comments starting with "V1:" highlight differences relative to V3 and 4.
const signTypedDataV1Examples = {
  // dynamic types supported by EIP-712:
  bytes: [10, '10', '0x10', Buffer.from('10', 'utf8')],
  string: [
    'Hello!',
    '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
    '0xabcd',
    '😁',
  ],
  // atomic types supported by EIP-712:
  address: [
    '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
    // V1: No apparent maximum address length
    '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbBbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
    '0x0',
    10,
    Number.MAX_SAFE_INTEGER,
  ],
  bool: [true, false, 'true', 'false', 0, 1, -1, Number.MAX_SAFE_INTEGER],
  bytes1: [
    '0x10',
    10,
    0,
    1,
    -1,
    Number.MAX_SAFE_INTEGER,
    Buffer.from('10', 'utf8'),
  ],
  bytes32: [
    '0x10',
    10,
    0,
    1,
    -1,
    Number.MAX_SAFE_INTEGER,
    Buffer.from('10', 'utf8'),
  ],
  int8: [0, '0', '0x0', 255, -255],
  int256: [0, '0', '0x0', Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER],
  uint8: [0, '0', '0x0', 255, -255],
  uint256: [
    0,
    '0',
    '0x0',
    Number.MAX_SAFE_INTEGER,
    // V1: Negative unsigned integers
    Number.MIN_SAFE_INTEGER,
  ],
  // atomic types not supported by EIP-712:
  int: [0, '0', '0x0', Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER], // interpreted as `int256` by `ethereumjs-abi`
  uint: [0, '0', '0x0', Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER], // interpreted as `uint256` by `ethereumjs-abi`
  // `fixed` and `ufixed` types omitted because their encoding in `ethereumjs-abi` is very broken at the moment.
  // `function` type omitted because it is not supported by `ethereumjs-abi`.
};

const signTypedDataV1ErrorExamples = {
  string: [
    {
      // V1: Does not accept numbers as strings (arguably correctly).
      input: 10,
      errorMessage: 'Value must be a string.',
    },
  ],
  address: [
    {
      // V1: Unprefixed addresses are not accepted.
      input: 'bBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
      errorMessage:
        'Expected a bytes-like value, got "bBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB".',
    },
  ],
  int8: [
    {
      input: '256',
      errorMessage:
        'Unable to encode value: Number "256" is out of range for type "int8".',
    },
  ],
  bytes1: [
    {
      input: 'a',
      errorMessage: 'Expected a bytes-like value, got "a".',
    },
    {
      input: 'test',
      errorMessage: 'Expected a bytes-like value, got "test".',
    },
  ],
  bytes32: [
    {
      input: 'a',
      errorMessage: 'Expected a bytes-like value, got "a".',
    },
    {
      input: 'test',
      errorMessage: 'Expected a bytes-like value, got "test".',
    },
  ],
};

// Union of all types from both sets of examples
const allSignTypedDataV1ExampleTypes = [
  ...new Set(
    Object.keys(encodeDataExamples).concat(
      Object.keys(encodeDataErrorExamples),
    ),
  ),
];

describe('typedSignatureHash', function () {
  for (const type of allSignTypedDataV1ExampleTypes) {
    describe(`type "${type}"`, function () {
      // Test all examples that do not crash
      const inputs = signTypedDataV1Examples[type] || [];
      for (const input of inputs) {
        const inputType = input instanceof Buffer ? 'Buffer' : typeof input;
        it(`should hash "${input}" (type "${inputType}")`, function () {
          const typedData = [{ type, name: 'message', value: input }];

          expect(typedSignatureHash(typedData)).toMatchSnapshot();
        });
      }

      const errorInputs = signTypedDataV1ErrorExamples[type] || [];
      for (const { input, errorMessage } of errorInputs) {
        const inputType = input instanceof Buffer ? 'Buffer' : typeof input;
        it(`should fail to hash "${input}" (type "${inputType}")`, function () {
          const typedData = [{ type, name: 'message', value: input }];

          expect(() => typedSignatureHash(typedData)).toThrow(errorMessage);
        });
      }
    });
  }

  const invalidTypedMessages = [
    {
      input: [],
      errorMessage: 'Expect argument to be non-empty array',
      label: 'an empty array',
    },
    {
      input: 42,
      errorMessage: 'Expect argument to be non-empty array',
      label: 'a number',
    },
    {
      input: null,
      errorMessage: "Cannot use 'in' operator to search for 'length' in null",
      label: 'null',
    },
    {
      input: undefined,
      errorMessage: 'Expect argument to be non-empty array',
      label: 'undefined',
    },
    {
      input: [
        {
          type: 'jocker',
          name: 'message',
          value: 'Hi, Alice!',
        },
      ],
      errorMessage:
        'Unable to encode value: The type "jocker" is not supported.',
      label: 'an unrecognized type',
    },
    {
      input: [
        {
          name: 'message',
          value: 'Hi, Alice!',
        },
      ],
      errorMessage: 'Cannot read',
      label: 'no type',
    },
    {
      input: [
        {
          type: 'string',
          value: 'Hi, Alice!',
        },
      ],
      errorMessage: 'Expect argument to be non-empty array',
      label: 'no name',
    },
  ];

  for (const { input, errorMessage, label } of invalidTypedMessages) {
    it(`should throw when given ${label}`, function () {
      expect(() => typedSignatureHash(input as any)).toThrow(errorMessage);
    });
  }

  it('should hash a message with multiple entries', function () {
    const typedData = [
      {
        type: 'string',
        name: 'message',
        value: 'Hi, Alice!',
      },
      {
        type: 'uint8',
        name: 'value',
        value: 10,
      },
    ];

    expect(typedSignatureHash(typedData)).toMatchInlineSnapshot(
      `"0xf7ad23226db5c1c00ca0ca1468fd49c8f8bbc1489bc1c382de5adc557a69c229"`,
    );
  });
});

describe('signTypedData', function () {
  describe('V1', function () {
    it('should throw when given an empty array', function () {
      expect(() =>
        signTypedData({
          privateKey,
          data: [],
          version: SignTypedDataVersion.V1,
        }),
      ).toThrow('Expect argument to be non-empty array');
    });

    describe('example data', function () {
      for (const type of allSignTypedDataV1ExampleTypes) {
        describe(`type "${type}"`, function () {
          // Test all examples that do not crash
          const inputs = signTypedDataV1Examples[type] || [];
          for (const input of inputs) {
            const inputType = input instanceof Buffer ? 'Buffer' : typeof input;
            it(`should sign "${input}" (type "${inputType}")`, function () {
              expect(
                signTypedData({
                  privateKey,
                  data: [{ name: 'data', type, value: input }],
                  version: SignTypedDataVersion.V1,
                }),
              ).toMatchSnapshot();
            });
          }

          // Test all examples that crash
          const errorInputs = signTypedDataV1ErrorExamples[type] || [];
          for (const { input, errorMessage } of errorInputs) {
            const inputType = input instanceof Buffer ? 'Buffer' : typeof input;
            it(`should fail to sign "${input}" (type "${inputType}")`, function () {
              expect(() =>
                signTypedData({
                  privateKey,
                  data: [{ name: 'data', type, value: input }],
                  version: SignTypedDataVersion.V1,
                }),
              ).toThrow(errorMessage);
            });
          }

          if (type === 'bytes') {
            it(`should fail to sign array of all ${type} example data`, function () {
              expect(() =>
                signTypedData({
                  privateKey,
                  data: [{ name: 'data', type: `${type}[]`, value: inputs }],
                  version: SignTypedDataVersion.V1,
                }),
              ).toThrow('Expected a bytes-like value, got "10".');
            });
          } else {
            it(`should sign array of all ${type} example data`, function () {
              expect(
                signTypedData({
                  privateKey,
                  data: [{ name: 'data', type: `${type}[]`, value: inputs }],
                  version: SignTypedDataVersion.V1,
                }),
              ).toMatchSnapshot();
            });
          }
        });
      }
    });

    it('should throw an error when an atomic property is set to null', function () {
      expect(() =>
        signTypedData({
          privateKey,
          data: [{ name: 'data', type: 'int32', value: null }],
          version: SignTypedDataVersion.V1,
        }),
      ).toThrow(
        'Unable to encode value: Invalid number. Expected a valid number value, but received "null".',
      );
    });

    it('should sign data with an atomic property set to undefined', function () {
      expect(() =>
        signTypedData({
          privateKey,
          data: [{ name: 'data', type: 'int32', value: undefined }],
          version: SignTypedDataVersion.V1,
        }),
      ).toMatchSnapshot();
    });

    it('should sign data with a dynamic property set to null', function () {
      expect(() =>
        signTypedData({
          privateKey,
          data: [{ name: 'data', type: 'string', value: null }],
          version: SignTypedDataVersion.V1,
        }),
      ).toThrow('Value must be a string.');
    });

    it('should sign data with a dynamic property set to undefined', function () {
      expect(() =>
        signTypedData({
          privateKey,
          data: [{ name: 'data', type: 'string', value: undefined }],
          version: SignTypedDataVersion.V1,
        }),
      ).toMatchSnapshot();
    });

    it('should throw an error when trying to sign a function', function () {
      expect(() =>
        signTypedData({
          privateKey,
          data: [
            {
              name: 'data',
              type: 'function',
              value: () => console.log(test),
            },
          ],
          version: SignTypedDataVersion.V1,
        }),
      ).toThrow('Unsupported or invalid type: "function"');
    });

    it('should throw an error when trying to sign an unrecognized type', function () {
      expect(() =>
        signTypedData({
          privateKey,
          data: [{ name: 'data', type: 'foo', value: 'test' }],
          version: SignTypedDataVersion.V1,
        }),
      ).toThrow('Unable to encode value: The type "foo" is not supported.');
    });
  });

  describe('V3', function () {
    // This first group of tests mirrors the `TypedDataUtils.eip712Hash` tests, because all of
    // those test cases are relevant here as well.

    it('should sign a minimal valid typed message', function () {
      const signature = signTypedData({
        privateKey,
        // This represents the most basic "typed message" that is valid according to our types.
        // It's not a very useful message (it's totally empty), but it's complete according to the
        // spec.
        data: {
          types: {
            EIP712Domain: [],
          },
          primaryType: 'EIP712Domain',
          domain: {},
          message: {},
        },
        version: SignTypedDataVersion.V3,
      });

      expect(signature).toMatchSnapshot();
    });

    it('minimal typed message signature should be identical to minimal valid typed message signature', function () {
      const minimalSignature = signTypedData({
        privateKey,
        // This tests that when the mandatory fields `domain`, `message`, and `types.EIP712Domain`
        // are omitted, the result is the same as if they were included but empty.
        data: {
          types: {},
          primaryType: 'EIP712Domain',
        } as any,
        version: SignTypedDataVersion.V3,
      });
      const minimalValidSignature = signTypedData({
        privateKey,
        data: {
          types: {
            EIP712Domain: [],
          },
          primaryType: 'EIP712Domain',
          domain: {},
          message: {},
        },
        version: SignTypedDataVersion.V3,
      });

      expect(minimalSignature).toBe(minimalValidSignature);
    });

    it('should ignore extra data properties', function () {
      const minimalValidSignature = signTypedData({
        privateKey,
        data: {
          types: {
            EIP712Domain: [],
          },
          primaryType: 'EIP712Domain',
          domain: {},
          message: {},
        },
        version: SignTypedDataVersion.V3,
      });
      const extraPropertiesSignature = signTypedData({
        privateKey,
        data: {
          types: {
            EIP712Domain: [],
          },
          primaryType: 'EIP712Domain',
          domain: {},
          message: {},
          extra: 'stuff',
          moreExtra: 1,
        } as any,
        version: SignTypedDataVersion.V3,
      });

      expect(minimalValidSignature).toBe(extraPropertiesSignature);
    });

    it('should sign a typed message with a domain separator that uses all fields', function () {
      const signature = signTypedData({
        privateKey,
        data: {
          types: {
            EIP712Domain: [
              {
                name: 'name',
                type: 'string',
              },
              {
                name: 'version',
                type: 'string',
              },
              {
                name: 'chainId',
                type: 'uint256',
              },
              {
                name: 'verifyingContract',
                type: 'address',
              },
              {
                name: 'salt',
                type: 'bytes32',
              },
            ],
          },
          primaryType: 'EIP712Domain',
          domain: {
            name: 'example.metamask.io',
            version: '1',
            chainId: 1,
            verifyingContract: '0x0000000000000000000000000000000000000000',
            salt: Buffer.from(new Int32Array([1, 2, 3])),
          },
          message: {},
        },
        version: SignTypedDataVersion.V3,
      });

      expect(signature).toMatchSnapshot();
    });

    it('should sign a typed message with extra domain seperator fields', function () {
      const signature = signTypedData({
        privateKey,
        data: {
          types: {
            EIP712Domain: [
              {
                name: 'name',
                type: 'string',
              },
              {
                name: 'version',
                type: 'string',
              },
              {
                name: 'chainId',
                type: 'uint256',
              },
              {
                name: 'verifyingContract',
                type: 'address',
              },
              {
                name: 'salt',
                type: 'bytes32',
              },
              {
                name: 'extraField',
                type: 'string',
              },
            ],
          },
          primaryType: 'EIP712Domain',
          domain: {
            name: 'example.metamask.io',
            version: '1',
            chainId: 1,
            verifyingContract: '0x0000000000000000000000000000000000000000',
            salt: Buffer.from(new Int32Array([1, 2, 3])),
            extraField: 'stuff',
          },
          message: {},
        } as any,
        version: SignTypedDataVersion.V3,
      });

      expect(signature).toMatchSnapshot();
    });

    it('should sign a typed message with only custom domain seperator fields', function () {
      const signature = signTypedData({
        privateKey,
        data: {
          types: {
            EIP712Domain: [
              {
                name: 'customName',
                type: 'string',
              },
              {
                name: 'customVersion',
                type: 'string',
              },
              {
                name: 'customChainId',
                type: 'uint256',
              },
              {
                name: 'customVerifyingContract',
                type: 'address',
              },
              {
                name: 'customSalt',
                type: 'bytes32',
              },
              {
                name: 'extraField',
                type: 'string',
              },
            ],
          },
          primaryType: 'EIP712Domain',
          domain: {
            customName: 'example.metamask.io',
            customVersion: '1',
            customChainId: 1,
            customVerifyingContract:
              '0x0000000000000000000000000000000000000000',
            customSalt: Buffer.from(new Int32Array([1, 2, 3])),
            extraField: 'stuff',
          },
          message: {},
        } as any,
        version: SignTypedDataVersion.V3,
      });

      expect(signature).toMatchSnapshot();
    });

    it('should sign a typed message with data', function () {
      const signature = signTypedData({
        privateKey,
        data: {
          types: {
            EIP712Domain: [
              {
                name: 'name',
                type: 'string',
              },
              {
                name: 'version',
                type: 'string',
              },
              {
                name: 'chainId',
                type: 'uint256',
              },
              {
                name: 'verifyingContract',
                type: 'address',
              },
              {
                name: 'salt',
                type: 'bytes32',
              },
            ],
            Message: [{ name: 'data', type: 'string' }],
          },
          primaryType: 'Message',
          domain: {
            name: 'example.metamask.io',
            version: '1',
            chainId: 1,
            verifyingContract: '0x0000000000000000000000000000000000000000',
            salt: Buffer.from(new Int32Array([1, 2, 3])),
          },
          message: {
            data: 'Hello!',
          },
        },
        version: SignTypedDataVersion.V3,
      });

      expect(signature).toMatchSnapshot();
    });

    // This second group of tests mirrors the `TypedDataUtils.encodeData` tests, because all of
    // those test cases are relevant here as well.

    describe('example data', function () {
      for (const type of allExampleTypes) {
        describe(`type "${type}"`, function () {
          // Test all examples that do not crash
          const inputs = encodeDataExamples[type] || [];
          for (const input of inputs) {
            const inputType = input instanceof Buffer ? 'Buffer' : typeof input;
            it(`should sign "${input}" (type "${inputType}")`, function () {
              expect(
                signTypedData({
                  privateKey,
                  data: {
                    types: {
                      EIP712Domain: [],
                      Message: [{ name: 'data', type }],
                    },
                    primaryType: 'Message',
                    domain: {},
                    message: {
                      data: input,
                    },
                  },
                  version: SignTypedDataVersion.V3,
                }),
              ).toMatchSnapshot();
            });
          }

          // Test all examples that crash
          const errorInputs = encodeDataErrorExamples[type] || [];
          for (const { input, errorMessage } of errorInputs) {
            const inputType = input instanceof Buffer ? 'Buffer' : typeof input;
            it(`should fail to sign "${input}" (type "${inputType}")`, function () {
              expect(() =>
                signTypedData({
                  privateKey,
                  data: {
                    types: {
                      EIP712Domain: [],
                      Message: [{ name: 'data', type }],
                    },
                    primaryType: 'Message',
                    domain: {},
                    message: {
                      data: input,
                    },
                  },
                  version: SignTypedDataVersion.V3,
                }),
              ).toThrow(errorMessage);
            });
          }

          it(`should fail to sign array of all ${type} example data`, function () {
            expect(() =>
              signTypedData({
                privateKey,
                data: {
                  types: {
                    EIP712Domain: [],
                    Message: [{ name: 'data', type: `${type}[]` }],
                  },
                  primaryType: 'Message',
                  domain: {},
                  message: {
                    data: inputs,
                  },
                },
                version: SignTypedDataVersion.V3,
              }),
            ).toThrow(
              'Arrays are unimplemented in encodeData; use V4 extension',
            );
          });
        });
      }
    });

    it('should sign data with custom type', function () {
      const types = {
        EIP712Domain: [],
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: 'Hello, Bob!',
      };

      expect(
        signTypedData({
          privateKey,
          data: {
            types,
            primaryType,
            domain: {},
            message,
          },
          version: SignTypedDataVersion.V3,
        }),
      ).toMatchSnapshot();
    });

    it('should sign data with a recursive data type', function () {
      const types = {
        EIP712Domain: [],
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
          { name: 'replyTo', type: 'Mail' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: 'Hello, Bob!',
        replyTo: {
          to: {
            name: 'Cow',
            wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
          },
          from: {
            name: 'Bob',
            wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
          },
          contents: 'Hello!',
        },
      };

      expect(
        signTypedData({
          privateKey,
          data: {
            types,
            primaryType,
            domain: {},
            message,
          },
          version: SignTypedDataVersion.V3,
        }),
      ).toMatchSnapshot();
    });

    it('should throw an error when trying to sign a custom type array', function () {
      const types = {
        EIP712Domain: [],
        Message: [{ name: 'data', type: 'string[]' }],
      };
      const message = { data: ['1', '2', '3'] };
      const primaryType = 'Message';

      expect(() =>
        signTypedData({
          privateKey,
          data: {
            types,
            primaryType,
            domain: {},
            message,
          },
          version: SignTypedDataVersion.V3,
        }),
      ).toThrow('Arrays are unimplemented in encodeData; use V4 extension');
    });

    it('should ignore extra unspecified message properties', function () {
      const types = {
        EIP712Domain: [],
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: 'Hello, Bob!',
      };

      const originalSignature = signTypedData({
        privateKey,
        data: {
          types,
          primaryType,
          domain: {},
          message,
        },
        version: SignTypedDataVersion.V3,
      });
      const messageWithExtraProperties = { ...message, foo: 'bar' };
      const signatureWithExtraProperties = signTypedData({
        privateKey,
        data: {
          types,
          primaryType,
          domain: {},
          message: messageWithExtraProperties,
        },
        version: SignTypedDataVersion.V3,
      });

      expect(originalSignature).toBe(signatureWithExtraProperties);
    });

    it('should throw an error when an atomic property is set to null', function () {
      const types = {
        EIP712Domain: [],
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
          { name: 'length', type: 'int32' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: 'Hello!',
        length: null,
      };

      expect(() =>
        signTypedData({
          privateKey,
          data: {
            types,
            primaryType,
            domain: {},
            message,
          },
          version: SignTypedDataVersion.V3,
        }),
      ).toThrow(
        'Unable to encode value: Invalid number. Expected a valid number value, but received "null".',
      );
    });

    it('should sign data with an atomic property set to undefined', function () {
      const types = {
        EIP712Domain: [],
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
          { name: 'length', type: 'int32' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: 'Hello!',
        length: undefined,
      };

      expect(
        signTypedData({
          privateKey,
          data: {
            types,
            primaryType,
            domain: {},
            message,
          },
          version: SignTypedDataVersion.V3,
        }),
      ).toMatchSnapshot();
    });

    it('should sign data with a dynamic property set to null', function () {
      const types = {
        EIP712Domain: [],
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: null,
      };

      expect(
        signTypedData({
          privateKey,
          data: {
            types,
            primaryType,
            domain: {},
            message,
          },
          version: SignTypedDataVersion.V3,
        }),
      ).toMatchSnapshot();
    });

    it('should sign data with a dynamic property set to undefined', function () {
      const types = {
        EIP712Domain: [],
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: undefined,
      };

      expect(
        signTypedData({
          privateKey,
          data: {
            types,
            primaryType,
            domain: {},
            message,
          },
          version: SignTypedDataVersion.V3,
        }),
      ).toMatchSnapshot();
    });

    it('should throw an error when a custom type property is set to null', function () {
      const types = {
        EIP712Domain: [],
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        to: null,
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        contents: 'Hello, Bob!',
      };

      expect(() =>
        signTypedData({
          privateKey,
          data: {
            types,
            primaryType,
            domain: {},
            message,
          },
          version: SignTypedDataVersion.V3,
        }),
      ).toThrow(/^Cannot read prop.+ null/u);
    });

    it('should sign data with a custom type property set to undefined', function () {
      const types = {
        EIP712Domain: [],
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: undefined,
        contents: 'Hello, Bob!',
      };

      expect(
        signTypedData({
          privateKey,
          data: {
            types,
            primaryType,
            domain: {},
            message,
          },
          version: SignTypedDataVersion.V3,
        }),
      ).toMatchSnapshot();
    });

    it('should throw an error when trying to sign a function', function () {
      const types = {
        EIP712Domain: [],
        Message: [{ name: 'data', type: 'function' }],
      };
      const message = { data: 'test' };
      const primaryType = 'Message';

      expect(() =>
        signTypedData({
          privateKey,
          data: {
            types,
            primaryType,
            domain: {},
            message,
          },
          version: SignTypedDataVersion.V3,
        }),
      ).toThrow('Unsupported or invalid type: "function"');
    });

    it('should throw an error when trying to sign with a missing primary type definition', function () {
      const types = {
        EIP712Domain: [],
      };
      const message = { data: 'test' };
      const primaryType = 'Message';

      expect(() =>
        signTypedData({
          privateKey,
          data: {
            types,
            primaryType,
            domain: {},
            message,
          } as any,
          version: SignTypedDataVersion.V3,
        }),
      ).toThrow('No type definition specified: Message');
    });

    it('should throw an error when trying to sign an unrecognized type', function () {
      const types = {
        EIP712Domain: [],
        Message: [{ name: 'data', type: 'foo' }],
      };
      const message = { data: 'test' };
      const primaryType = 'Message';

      expect(() =>
        signTypedData({
          privateKey,
          data: {
            types,
            primaryType,
            domain: {},
            message,
          },
          version: SignTypedDataVersion.V3,
        }),
      ).toThrow('Unable to encode value: The type "foo" is not supported.');
    });

    it('should sign data when given extraneous types', function () {
      const types = {
        EIP712Domain: [],
        Message: [{ name: 'data', type: 'string' }],
        Extra: [{ name: 'data', type: 'string' }],
      };
      const message = { data: 'Hello!' };
      const primaryType = 'Message';

      expect(
        signTypedData({
          privateKey,
          data: {
            types,
            primaryType,
            domain: {},
            message,
          },
          version: SignTypedDataVersion.V3,
        }),
      ).toMatchSnapshot();
    });
  });

  describe('V4', function () {
    // This first group of tests mirrors the `TypedDataUtils.eip712Hash` tests, because all of
    // those test cases are relevant here as well.

    it('should sign a minimal valid typed message', function () {
      const signature = signTypedData({
        privateKey,
        // This represents the most basic "typed message" that is valid according to our types.
        // It's not a very useful message (it's totally empty), but it's complete according to the
        // spec.
        data: {
          types: {
            EIP712Domain: [],
          },
          primaryType: 'EIP712Domain',
          domain: {},
          message: {},
        },
        version: SignTypedDataVersion.V4,
      });

      expect(signature).toMatchSnapshot();
    });

    it('minimal typed message signature should be identical to minimal valid typed message signature', function () {
      const minimalSignature = signTypedData({
        privateKey,
        // This tests that when the mandatory fields `domain`, `message`, and `types.EIP712Domain`
        // are omitted, the result is the same as if they were included but empty.
        data: {
          types: {},
          primaryType: 'EIP712Domain',
        } as any,
        version: SignTypedDataVersion.V4,
      });
      const minimalValidSignature = signTypedData({
        privateKey,
        data: {
          types: {
            EIP712Domain: [],
          },
          primaryType: 'EIP712Domain',
          domain: {},
          message: {},
        },
        version: SignTypedDataVersion.V4,
      });

      expect(minimalSignature).toBe(minimalValidSignature);
    });

    it('should ignore extra data properties', function () {
      const minimalValidSignature = signTypedData({
        privateKey,
        data: {
          types: {
            EIP712Domain: [],
          },
          primaryType: 'EIP712Domain',
          domain: {},
          message: {},
        },
        version: SignTypedDataVersion.V4,
      });
      const extraPropertiesSignature = signTypedData({
        privateKey,
        data: {
          types: {
            EIP712Domain: [],
          },
          primaryType: 'EIP712Domain',
          domain: {},
          message: {},
          extra: 'stuff',
          moreExtra: 1,
        } as any,
        version: SignTypedDataVersion.V4,
      });

      expect(minimalValidSignature).toBe(extraPropertiesSignature);
    });

    it('should sign a typed message with a domain separator that uses all fields', function () {
      const signature = signTypedData({
        privateKey,
        data: {
          types: {
            EIP712Domain: [
              {
                name: 'name',
                type: 'string',
              },
              {
                name: 'version',
                type: 'string',
              },
              {
                name: 'chainId',
                type: 'uint256',
              },
              {
                name: 'verifyingContract',
                type: 'address',
              },
              {
                name: 'salt',
                type: 'bytes32',
              },
            ],
          },
          primaryType: 'EIP712Domain',
          domain: {
            name: 'example.metamask.io',
            version: '1',
            chainId: 1,
            verifyingContract: '0x0000000000000000000000000000000000000000',
            salt: Buffer.from(new Int32Array([1, 2, 3])),
          },
          message: {},
        },
        version: SignTypedDataVersion.V4,
      });

      expect(signature).toMatchSnapshot();
    });

    it('should sign a typed message with extra domain seperator fields', function () {
      const signature = signTypedData({
        privateKey,
        data: {
          types: {
            EIP712Domain: [
              {
                name: 'name',
                type: 'string',
              },
              {
                name: 'version',
                type: 'string',
              },
              {
                name: 'chainId',
                type: 'uint256',
              },
              {
                name: 'verifyingContract',
                type: 'address',
              },
              {
                name: 'salt',
                type: 'bytes32',
              },
              {
                name: 'extraField',
                type: 'string',
              },
            ],
          },
          primaryType: 'EIP712Domain',
          domain: {
            name: 'example.metamask.io',
            version: '1',
            chainId: 1,
            verifyingContract: '0x0000000000000000000000000000000000000000',
            salt: Buffer.from(new Int32Array([1, 2, 3])),
            extraField: 'stuff',
          },
          message: {},
        } as any,
        version: SignTypedDataVersion.V4,
      });

      expect(signature).toMatchSnapshot();
    });

    it('should sign a typed message with only custom domain seperator fields', function () {
      const signature = signTypedData({
        privateKey,
        data: {
          types: {
            EIP712Domain: [
              {
                name: 'customName',
                type: 'string',
              },
              {
                name: 'customVersion',
                type: 'string',
              },
              {
                name: 'customChainId',
                type: 'uint256',
              },
              {
                name: 'customVerifyingContract',
                type: 'address',
              },
              {
                name: 'customSalt',
                type: 'bytes32',
              },
              {
                name: 'extraField',
                type: 'string',
              },
            ],
          },
          primaryType: 'EIP712Domain',
          domain: {
            customName: 'example.metamask.io',
            customVersion: '1',
            customChainId: 1,
            customVerifyingContract:
              '0x0000000000000000000000000000000000000000',
            customSalt: Buffer.from(new Int32Array([1, 2, 3])),
            extraField: 'stuff',
          },
          message: {},
        } as any,
        version: SignTypedDataVersion.V4,
      });

      expect(signature).toMatchSnapshot();
    });

    it('should sign a typed message with data', function () {
      const signature = signTypedData({
        privateKey,
        data: {
          types: {
            EIP712Domain: [
              {
                name: 'name',
                type: 'string',
              },
              {
                name: 'version',
                type: 'string',
              },
              {
                name: 'chainId',
                type: 'uint256',
              },
              {
                name: 'verifyingContract',
                type: 'address',
              },
              {
                name: 'salt',
                type: 'bytes32',
              },
            ],
            Message: [{ name: 'data', type: 'string' }],
          },
          primaryType: 'Message',
          domain: {
            name: 'example.metamask.io',
            version: '1',
            chainId: 1,
            verifyingContract: '0x0000000000000000000000000000000000000000',
            salt: Buffer.from(new Int32Array([1, 2, 3])),
          },
          message: {
            data: 'Hello!',
          },
        },
        version: SignTypedDataVersion.V4,
      });

      expect(signature).toMatchSnapshot();
    });

    // This second group of tests mirrors the `TypedDataUtils.encodeData` tests, because all of
    // those test cases are relevant here as well.
    describe('example data', function () {
      for (const type of allExampleTypes) {
        describe(`type "${type}"`, function () {
          // Test all examples that do not crash
          const inputs = encodeDataExamples[type] || [];
          for (const input of inputs) {
            const inputType = input instanceof Buffer ? 'Buffer' : typeof input;
            it(`should sign "${
              input as string
            }" (type "${inputType}")`, function () {
              const types = {
                EIP712Domain: [],
                Message: [{ name: 'data', type }],
              };
              const message = { data: input };
              const primaryType = 'Message';

              expect(
                signTypedData({
                  privateKey,
                  data: {
                    types,
                    primaryType,
                    domain: {},
                    message,
                  },
                  version: SignTypedDataVersion.V4,
                }),
              ).toMatchSnapshot();
            });
          }

          // Test all examples that crash
          const errorInputs = encodeDataErrorExamples[type] || [];
          for (const { input, errorMessage } of errorInputs) {
            const inputType = input instanceof Buffer ? 'Buffer' : typeof input;
            it(`should fail to sign "${input}" (type "${inputType}")`, function () {
              const types = {
                EIP712Domain: [],
                Message: [{ name: 'data', type }],
              };
              const message = { data: input };
              const primaryType = 'Message';

              expect(() =>
                signTypedData({
                  privateKey,
                  data: {
                    types,
                    primaryType,
                    domain: {},
                    message,
                  },
                  version: SignTypedDataVersion.V4,
                }),
              ).toThrow(errorMessage);
            });
          }

          it(`should sign array of all ${type} example data`, function () {
            const types = {
              EIP712Domain: [],
              Message: [{ name: 'data', type: `${type}[]` }],
            };
            const message = { data: inputs };
            const primaryType = 'Message';
            expect(
              signTypedData({
                privateKey,
                data: {
                  types,
                  primaryType,
                  domain: {},
                  message,
                },
                version: SignTypedDataVersion.V4,
              }),
            ).toMatchSnapshot();
          });
        });
      }
    });

    it('should sign data with custom type', function () {
      const types = {
        EIP712Domain: [],
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: 'Hello, Bob!',
      };

      expect(
        signTypedData({
          privateKey,
          data: {
            types,
            primaryType,
            domain: {},
            message,
          },
          version: SignTypedDataVersion.V4,
        }),
      ).toMatchSnapshot();
    });

    it('should sign data with a recursive data type', function () {
      const types = {
        EIP712Domain: [],
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
          { name: 'replyTo', type: 'Mail' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: 'Hello, Bob!',
        replyTo: {
          to: {
            name: 'Cow',
            wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
          },
          from: {
            name: 'Bob',
            wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
          },
          contents: 'Hello!',
        },
      };

      expect(
        signTypedData({
          privateKey,
          data: {
            types,
            primaryType,
            domain: {},
            message,
          },
          version: SignTypedDataVersion.V4,
        }),
      ).toMatchSnapshot();
    });

    it('should sign data with a custom data type array', function () {
      const types = {
        EIP712Domain: [],
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address[]' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person[]' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: [
            '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
            '0xDD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
          ],
        },
        to: [
          {
            name: 'Bob',
            wallet: ['0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB'],
          },
        ],
        contents: 'Hello, Bob!',
      };

      expect(
        signTypedData({
          privateKey,
          data: {
            types,
            primaryType,
            domain: {},
            message,
          },
          version: SignTypedDataVersion.V4,
        }),
      ).toMatchSnapshot();
    });

    it('should ignore extra unspecified message properties', function () {
      const types = {
        EIP712Domain: [],
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: 'Hello, Bob!',
      };

      const originalSignature = signTypedData({
        privateKey,
        data: {
          types,
          primaryType,
          domain: {},
          message,
        },
        version: SignTypedDataVersion.V4,
      });
      const messageWithExtraProperties = { ...message, foo: 'bar' };
      const signatureWithExtraProperties = signTypedData({
        privateKey,
        data: {
          types,
          primaryType,
          domain: {},
          message: messageWithExtraProperties,
        },
        version: SignTypedDataVersion.V4,
      });

      expect(originalSignature).toBe(signatureWithExtraProperties);
    });

    it('should throw an error when an atomic property is set to null', function () {
      const types = {
        EIP712Domain: [],
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
          { name: 'length', type: 'int32' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: 'Hello!',
        length: null,
      };

      expect(() =>
        signTypedData({
          privateKey,
          data: {
            types,
            primaryType,
            domain: {},
            message,
          },
          version: SignTypedDataVersion.V4,
        }),
      ).toThrow(
        'Unable to encode value: Invalid number. Expected a valid number value, but received "null"',
      );
    });

    it('should throw an error when an atomic property is set to undefined', function () {
      const types = {
        EIP712Domain: [],
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
          { name: 'length', type: 'int32' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: 'Hello!',
        length: undefined,
      };

      expect(() =>
        signTypedData({
          privateKey,
          data: {
            types,
            primaryType,
            domain: {},
            message,
          },
          version: SignTypedDataVersion.V4,
        }),
      ).toThrow('missing value for field length of type int32');
    });

    it('should sign data with a dynamic property set to null', function () {
      const types = {
        EIP712Domain: [],
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: null,
      };

      expect(
        signTypedData({
          privateKey,
          data: {
            types,
            primaryType,
            domain: {},
            message,
          },
          version: SignTypedDataVersion.V4,
        }),
      ).toMatchSnapshot();
    });

    it('should throw an error when a dynamic property is set to undefined', function () {
      const types = {
        EIP712Domain: [],
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        },
        contents: undefined,
      };

      expect(() =>
        signTypedData({
          privateKey,
          data: {
            types,
            primaryType,
            domain: {},
            message,
          },
          version: SignTypedDataVersion.V4,
        }),
      ).toThrow('missing value for field contents of type string');
    });

    it('should sign data with a custom type property set to null', function () {
      const types = {
        EIP712Domain: [],
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        to: null,
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        contents: 'Hello, Bob!',
      };

      expect(
        signTypedData({
          privateKey,
          data: {
            types,
            primaryType,
            domain: {},
            message,
          },
          version: SignTypedDataVersion.V4,
        }),
      ).toMatchSnapshot();
    });

    it('should sign data with a custom type property set to undefined', function () {
      const types = {
        EIP712Domain: [],
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' },
        ],
      };
      const primaryType = 'Mail';
      const message = {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        },
        to: undefined,
        contents: 'Hello, Bob!',
      };

      expect(
        signTypedData({
          privateKey,
          data: {
            types,
            primaryType,
            domain: {},
            message,
          },
          version: SignTypedDataVersion.V4,
        }),
      ).toMatchSnapshot();
    });

    it('should throw an error when trying to encode a function', function () {
      const types = {
        EIP712Domain: [],
        Message: [{ name: 'data', type: 'function' }],
      };
      const message = { data: 'test' };
      const primaryType = 'Message';

      expect(() =>
        signTypedData({
          privateKey,
          data: {
            types,
            primaryType,
            domain: {},
            message,
          },
          version: SignTypedDataVersion.V4,
        }),
      ).toThrow('Unsupported or invalid type: "function"');
    });

    it('should throw an error when trying to sign with a missing primary type definition', function () {
      const types = {
        EIP712Domain: [],
      };
      const message = { data: 'test' };
      const primaryType = 'Message';

      expect(() =>
        signTypedData({
          privateKey,
          data: {
            types,
            primaryType,
            domain: {},
            message,
          } as any,
          version: SignTypedDataVersion.V4,
        }),
      ).toThrow('No type definition specified: Message');
    });

    it('should throw an error when trying to sign an unrecognized type', function () {
      const types = {
        EIP712Domain: [],
        Message: [{ name: 'data', type: 'foo' }],
      };
      const message = { data: 'test' };
      const primaryType = 'Message';

      expect(() =>
        signTypedData({
          privateKey,
          data: {
            types,
            primaryType,
            domain: {},
            message,
          },
          version: SignTypedDataVersion.V4,
        }),
      ).toThrow('Unable to encode value: The type "foo" is not supported.');
    });

    it('should sign data when given extraneous types', function () {
      const types = {
        EIP712Domain: [],
        Message: [{ name: 'data', type: 'string' }],
        Extra: [{ name: 'data', type: 'string' }],
      };
      const message = { data: 'Hello!' };
      const primaryType = 'Message';

      expect(
        signTypedData({
          privateKey,
          data: {
            types,
            primaryType,
            domain: {},
            message,
          },
          version: SignTypedDataVersion.V4,
        }),
      ).toMatchSnapshot();
    });
  });

  describe('validation', () => {
    it('should throw if passed an invalid version', () => {
      expect(() =>
        signTypedData({
          privateKey,
          data: [{ name: 'data', type: 'string', value: 'Hello!' }],
          version: 'V0' as any,
        }),
      ).toThrow('Invalid version');
    });

    it('should throw if passed null data', () => {
      expect(() =>
        signTypedData({
          privateKey,
          data: null as any,
          version: SignTypedDataVersion.V1,
        }),
      ).toThrow('Missing data parameter');
    });

    it('should throw if passed undefined data', () => {
      expect(() =>
        signTypedData({
          privateKey,
          data: undefined as any,
          version: SignTypedDataVersion.V1,
        }),
      ).toThrow('Missing data parameter');
    });

    it('should throw if passed a null private key', () => {
      expect(() =>
        signTypedData({
          privateKey: null as any,
          data: [{ name: 'data', type: 'string', value: 'Hello!' }],
          version: SignTypedDataVersion.V1,
        }),
      ).toThrow('Missing private key parameter');
    });

    it('should throw if passed an undefined private key', () => {
      expect(() =>
        signTypedData({
          privateKey: undefined as any,
          data: [{ name: 'data', type: 'string', value: 'Hello!' }],
          version: SignTypedDataVersion.V1,
        }),
      ).toThrow('Missing private key parameter');
    });
  });
});

describe('recoverTypedSignature', function () {
  describe('V1', function () {
    // This is a signature of the message "[{ name: 'message', type: 'string', value: 'Hi, Alice!' }]"
    // that was created using the private key in the top-level `privateKey` variable.
    const exampleSignature =
      '0x49e75d475d767de7fcc67f521e0d86590723d872e6111e51c393e8c1e2f21d032dfaf5833af158915f035db6af4f37bf2d5d29781cd81f28a44c5cb4b9d241531b';

    it('should recover the address of the signer', function () {
      const address = ethUtil.addHexPrefix(
        ethUtil.privateToAddress(privateKey).toString('hex'),
      );

      expect(
        recoverTypedSignature({
          data: [{ name: 'message', type: 'string', value: 'Hi, Alice!' }],
          signature: exampleSignature,
          version: SignTypedDataVersion.V1,
        }),
      ).toBe(address);
    });

    it('should sign typed data and recover the address of the signer', function () {
      const address = ethUtil.addHexPrefix(
        ethUtil.privateToAddress(privateKey).toString('hex'),
      );
      const message = [
        { name: 'message', type: 'string', value: 'Hi, Alice!' },
      ];
      const signature = signTypedData({
        privateKey,
        data: message,
        version: SignTypedDataVersion.V1,
      });

      expect(
        recoverTypedSignature({
          data: message,
          signature,
          version: SignTypedDataVersion.V1,
        }),
      ).toBe(address);
    });
  });

  describe('V3', function () {
    // This is a signature of the message in the test below that was created using the private key
    // in the top-level `privateKey` variable.
    const exampleSignature =
      '0xf6cda8eaf5137e8cc15d48d03a002b0512446e2a7acbc576c01cfbe40ad9345663ccda8884520d98dece9a8bfe38102851bdae7f69b3d8612b9808e6337801601b';

    it('should recover the address of the signer', function () {
      const address = ethUtil.addHexPrefix(
        ethUtil.privateToAddress(privateKey).toString('hex'),
      );
      const types = {
        EIP712Domain: [],
        Message: [{ name: 'data', type: 'string' }],
      };
      const message = { data: 'test' };
      const primaryType = 'Message' as const;
      const typedMessage = {
        types,
        primaryType,
        domain: {},
        message,
      };

      expect(
        recoverTypedSignature({
          data: typedMessage,
          signature: exampleSignature,
          version: SignTypedDataVersion.V3,
        }),
      ).toBe(address);
    });

    it('should sign typed data and recover the address of the signer', function () {
      const address = ethUtil.addHexPrefix(
        ethUtil.privateToAddress(privateKey).toString('hex'),
      );
      const types = {
        EIP712Domain: [],
        Message: [{ name: 'data', type: 'string' }],
      };
      const message = { data: 'test' };
      const primaryType = 'Message' as const;
      const typedMessage = {
        types,
        primaryType,
        domain: {},
        message,
      };
      const signature = signTypedData({
        privateKey,
        data: typedMessage,
        version: SignTypedDataVersion.V3,
      });

      expect(
        recoverTypedSignature({
          data: typedMessage,
          signature,
          version: SignTypedDataVersion.V3,
        }),
      ).toBe(address);
    });
  });

  describe('V4', function () {
    // This is a signature of the message in the test below that was created using the private key
    // in the top-level `privateKey` variable.
    const exampleSignature =
      '0xf6cda8eaf5137e8cc15d48d03a002b0512446e2a7acbc576c01cfbe40ad9345663ccda8884520d98dece9a8bfe38102851bdae7f69b3d8612b9808e6337801601b';

    it('should recover the address of the signer', function () {
      const address = ethUtil.addHexPrefix(
        ethUtil.privateToAddress(privateKey).toString('hex'),
      );
      const types = {
        EIP712Domain: [],
        Message: [{ name: 'data', type: 'string' }],
      };
      const message = { data: 'test' };
      const primaryType = 'Message' as const;
      const typedMessage = {
        types,
        primaryType,
        domain: {},
        message,
      };

      expect(
        recoverTypedSignature({
          data: typedMessage,
          signature: exampleSignature,
          version: SignTypedDataVersion.V4,
        }),
      ).toBe(address);
    });

    it('should sign typed data and recover the address of the signer', function () {
      const address = ethUtil.addHexPrefix(
        ethUtil.privateToAddress(privateKey).toString('hex'),
      );
      const types = {
        EIP712Domain: [],
        Message: [{ name: 'data', type: 'string' }],
      };
      const message = { data: 'test' };
      const primaryType = 'Message' as const;
      const typedMessage = {
        types,
        primaryType,
        domain: {},
        message,
      };
      const signature = signTypedData({
        privateKey,
        data: typedMessage,
        version: SignTypedDataVersion.V4,
      });

      expect(
        recoverTypedSignature({
          data: typedMessage,
          signature,
          version: SignTypedDataVersion.V4,
        }),
      ).toBe(address);
    });
  });

  describe('validation', () => {
    // This is a signature of the message "[{ name: 'message', type: 'string', value: 'Hi, Alice!' }]"
    // that was created using the private key in the top-level `privateKey` variable.
    const exampleSignature =
      '0x49e75d475d767de7fcc67f521e0d86590723d872e6111e51c393e8c1e2f21d032dfaf5833af158915f035db6af4f37bf2d5d29781cd81f28a44c5cb4b9d241531b';

    it('should throw if passed an invalid version', () => {
      expect(() =>
        recoverTypedSignature({
          data: [{ name: 'message', type: 'string', value: 'Hi, Alice!' }],
          signature: exampleSignature,
          version: 'V0' as any,
        }),
      ).toThrow('Invalid version');
    });

    it('should throw if passed null data', () => {
      expect(() =>
        recoverTypedSignature({
          data: null as any,
          signature: exampleSignature,
          version: SignTypedDataVersion.V1,
        }),
      ).toThrow('Missing data parameter');
    });

    it('should throw if passed undefined data', () => {
      expect(() =>
        recoverTypedSignature({
          data: undefined as any,
          signature: exampleSignature,
          version: SignTypedDataVersion.V1,
        }),
      ).toThrow('Missing data parameter');
    });

    it('should throw if passed a null signature', () => {
      expect(() =>
        recoverTypedSignature({
          data: [{ name: 'message', type: 'string', value: 'Hi, Alice!' }],
          signature: null as any,
          version: SignTypedDataVersion.V1,
        }),
      ).toThrow('Missing signature parameter');
    });

    it('should throw if passed an undefined signature', () => {
      expect(() =>
        recoverTypedSignature({
          data: [{ name: 'message', type: 'string', value: 'Hi, Alice!' }],
          signature: undefined as any,
          version: SignTypedDataVersion.V1,
        }),
      ).toThrow('Missing signature parameter');
    });
  });
});
