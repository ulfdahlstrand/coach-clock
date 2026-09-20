import { contract } from '@coach-clock/contracts';
import { OpenAPIGenerator } from '@orpc/openapi';
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4';

const generator = new OpenAPIGenerator({
  schemaConverters: [new ZodToJsonSchemaConverter()],
});

let cached: Promise<unknown> | undefined;

/**
 * OpenAPI-dokumentet genereras ur kontraktet — aldrig handskrivet, så det kan
 * inte glida isär från vad API:t faktiskt gör.
 */
export function getOpenApiDocument(): Promise<unknown> {
  cached ??= generator.generate(contract, {
    info: {
      title: 'coach-clock API',
      version: '0.0.0',
      description: 'Matchklocka för ungdomsfotboll.',
    },
  });

  return cached;
}
