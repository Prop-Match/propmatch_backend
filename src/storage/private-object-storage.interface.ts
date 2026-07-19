export type UploadPrivateObjectInput = {
  data: Buffer;
  contentType: string;
};

export type UploadPrivateObjectResult = {
  objectKey: string;
};

export interface PrivateObjectStorage {
  upload(input: UploadPrivateObjectInput): Promise<UploadPrivateObjectResult>;

  createTemporaryReadUrl(
    objectKey: string,
    expiresInSeconds: number,
  ): Promise<string>;

  delete(objectKey: string): Promise<void>;
}
