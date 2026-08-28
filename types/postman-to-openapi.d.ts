declare module "postman-to-openapi" {
  interface ConversionOptions {
    defaultTag?: string;
    info?: {
      title?: string;
      version?: string;
      description?: string;
    };
    [key: string]: unknown;
  }

  function postmanToOpenApi(
    inputPath: string,
    outputPath: string,
    options?: ConversionOptions
  ): Promise<string>;

  export default postmanToOpenApi;
}