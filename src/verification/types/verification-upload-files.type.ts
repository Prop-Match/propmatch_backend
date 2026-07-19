export type BufferedIdentityFile = {
  fieldname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

export type VerificationUploadFiles = {
  nationalIdFront?: BufferedIdentityFile[];
  nationalIdBack?: BufferedIdentityFile[];
  selfie?: BufferedIdentityFile[];
};

export type ValidatedIdentityFile = BufferedIdentityFile;

export type ValidatedVerificationFiles = {
  nationalIdFront: ValidatedIdentityFile;
  nationalIdBack: ValidatedIdentityFile;
  selfie: ValidatedIdentityFile;
};
