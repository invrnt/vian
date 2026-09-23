export default {
  hello: {
    description: 'Greet a person',
    inputSchema: { type: 'object', properties: { name: { type: 'string', minLength: 1 } }, required: ['name'], additionalProperties: false },
    execute(input: { name: string }) { return { greeting: `Hello, ${input.name}!` }; },
  },
};
