export type UploadPrivateObjectInput = {
  data: Buffer;
  contentType: string;
  /** Object key subfolder, e.g. 'identity' (default) or 'contracts'. */
  category?: string;
};

export type UploadPrivateObjectResult = {
  objectKey: string;
};

export type TemporaryPrivateObject = {
  data: Buffer;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
};

export interface PrivateObjectStorage {
  upload(input: UploadPrivateObjectInput): Promise<UploadPrivateObjectResult>;

  createTemporaryReadUrl(
    objectKey: string,
    expiresInSeconds: number,
  ): Promise<string>;

  readTemporaryObject(token: string): Promise<TemporaryPrivateObject>;

  delete(objectKey: string): Promise<void>;
}
