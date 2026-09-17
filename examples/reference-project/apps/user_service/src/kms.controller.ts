import { Controller, Get, Query } from '@nestjs/common';
import { Session } from '@yandex-cloud/nodejs-sdk';
import { symmetricCryptoService } from '@yandex-cloud/nodejs-sdk/kms-v1';

// SA-access probe (spec 036 verification): inside a YC function/container the
// Yandex Cloud Metadata Service issues a short-lived IAM token for the
// service account attached to the resource. `new Session()` (no explicit
// token) resolves that default SA token, and the KMS symmetric-crypto client
// encrypts/decrypts under the given key. The key id is NOT secret (YC KMS key
// ids are public identifiers; access is governed by IAM roles).
@Controller('kms')
export class KmsController {
  @Get()
  async probe(@Query('key') keyId?: string) {
    if (!keyId) {
      return { ok: false, error: "missing 'key' query parameter (KMS key id)" };
    }
    const session = new Session();
    const crypto = session.client(symmetricCryptoService.SymmetricCryptoServiceClient);
    const plaintext = Buffer.from('sdk-roundtrip-probe');
    const aadContext = Buffer.from('probe-aad');
    const encrypted = await crypto.encrypt(
      symmetricCryptoService.SymmetricEncryptRequest.fromPartial({
        keyId,
        plaintext,
        aadContext,
      }),
    );
    const decrypted = await crypto.decrypt(
      symmetricCryptoService.SymmetricDecryptRequest.fromPartial({
        keyId,
        ciphertext: encrypted.ciphertext,
        aadContext,
      }),
    );
    const roundtrip = Buffer.from(decrypted.plaintext).toString() === 'sdk-roundtrip-probe';
    return { ok: true, roundtrip };
  }
}