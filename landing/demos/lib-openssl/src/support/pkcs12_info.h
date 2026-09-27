#pragma once

#include <openssl/err.h>
#include <openssl/objects.h>
#include <openssl/pkcs12.h>
#include <openssl/pkcs7.h>
#include <openssl/provider.h>
#include <openssl/x509.h>

#include <memory>
#include <string>
#include <vector>

#include "app_text.h"
#include "pki.h"

// PKCS#12 (.p12, .pfx) files for the PFX app: read, written, and their protection described in
// the words `openssl pkcs12 -info` uses (apps/pkcs12.c, alg_print and dump_certs_pkeys_bags).
namespace sslapp {

struct FreePkcs12 {
    void operator()(PKCS12* p12) const { PKCS12_free(p12); }
};
using Pkcs12 = std::unique_ptr<PKCS12, FreePkcs12>;

inline Pkcs12 readPkcs12(const std::string& bytes) {
    BIO* in = BIO_new_mem_buf(bytes.data(), static_cast<int>(bytes.size()));
    PKCS12* p12 = d2i_PKCS12_bio(in, nullptr);
    BIO_free(in);
    if (!p12) fail("not a PKCS#12 file");
    return Pkcs12(p12);
}

inline std::string writePkcs12(PKCS12* p12) {
    BIO* out = BIO_new(BIO_s_mem());
    if (i2d_PKCS12_bio(out, p12) != 1) {
        BIO_free(out);
        fail("cannot write the PKCS#12 file");
    }
    return drain(out);
}

// RC2-40, 3DES and the other old PKCS#12 ciphers live in OpenSSL 3's legacy provider, which is
// compiled into this build but off until loaded, and unloaded again when this ends. Loading any
// provider by name stops OpenSSL from loading the default one on its own, so the default is
// loaded here once and stays.
class LegacyProvider {
public:
    LegacyProvider() {
        static OSSL_PROVIDER* const standard = OSSL_PROVIDER_load(nullptr, "default");
        if (!standard) fail("cannot load the default provider");
        legacy = OSSL_PROVIDER_load(nullptr, "legacy");
        if (!legacy) fail("cannot load the legacy provider");
    }
    ~LegacyProvider() { OSSL_PROVIDER_unload(legacy); }
    LegacyProvider(const LegacyProvider&) = delete;
    LegacyProvider& operator=(const LegacyProvider&) = delete;

private:
    OSSL_PROVIDER* legacy = nullptr;
};

inline std::string objectName(const ASN1_OBJECT* object) {
    char name[80] = "";
    OBJ_obj2txt(name, sizeof name, object, 0);
    return name;
}

inline std::string pbkdf2Text(int parameterType, const void* parameter) {
    PBKDF2PARAM* kdf = parameterType == V_ASN1_SEQUENCE
        ? static_cast<PBKDF2PARAM*>(ASN1_item_unpack(static_cast<const ASN1_STRING*>(parameter), ASN1_ITEM_rptr(PBKDF2PARAM)))
        : nullptr;
    if (!kdf) return ", <unsupported parameters>";
    int prf = NID_hmacWithSHA1;
    if (kdf->prf) {
        const ASN1_OBJECT* object = nullptr;
        X509_ALGOR_get0(&object, nullptr, nullptr, kdf->prf);
        prf = OBJ_obj2nid(object);
    }
    const std::string text = ", Iteration " + std::to_string(ASN1_INTEGER_get(kdf->iter)) + ", PRF " + OBJ_nid2sn(prf);
    PBKDF2PARAM_free(kdf);
    return text;
}

// "PBES2, PBKDF2, AES-256-CBC, Iteration 2048, PRF hmacWithSHA256" or
// "pbeWithSHA1And40BitRC2-CBC, Iteration 2048".
inline std::string algorithmText(const X509_ALGOR* algorithm) {
    const ASN1_OBJECT* object = nullptr;
    int parameterType = 0;
    const void* parameter = nullptr;
    X509_ALGOR_get0(&object, &parameterType, &parameter, algorithm);
    const int nid = OBJ_obj2nid(object);
    const char* longName = OBJ_nid2ln(nid);
    std::string text = longName ? longName : "(null)";
    if (nid == NID_pbes2) {
        PBE2PARAM* pbes2 = parameterType == V_ASN1_SEQUENCE
            ? static_cast<PBE2PARAM*>(ASN1_item_unpack(static_cast<const ASN1_STRING*>(parameter), ASN1_ITEM_rptr(PBE2PARAM)))
            : nullptr;
        if (!pbes2) return text + ", <unsupported parameters>";
        X509_ALGOR_get0(&object, &parameterType, &parameter, pbes2->keyfunc);
        const int kdf = OBJ_obj2nid(object);
        const ASN1_OBJECT* cipher = nullptr;
        X509_ALGOR_get0(&cipher, nullptr, nullptr, pbes2->encryption);
        text += std::string(", ") + OBJ_nid2ln(kdf) + ", " + OBJ_nid2sn(OBJ_obj2nid(cipher));
        if (kdf == NID_id_pbkdf2) text += pbkdf2Text(parameterType, parameter);
        PBE2PARAM_free(pbes2);
        return text;
    }
    PBEPARAM* pbe = parameterType == V_ASN1_SEQUENCE
        ? static_cast<PBEPARAM*>(ASN1_item_unpack(static_cast<const ASN1_STRING*>(parameter), ASN1_ITEM_rptr(PBEPARAM)))
        : nullptr;
    if (!pbe) return text + ", <unsupported parameters>";
    text += ", Iteration " + std::to_string(ASN1_INTEGER_get(pbe->iter));
    PBEPARAM_free(pbe);
    return text;
}

// "sha256, Iteration 2048", or "none" for a file without a MAC.
inline std::string macText(const PKCS12* p12) {
    if (!PKCS12_mac_present(p12)) return "none";
    const ASN1_OCTET_STRING* mac = nullptr;
    const X509_ALGOR* algorithm = nullptr;
    const ASN1_OCTET_STRING* salt = nullptr;
    const ASN1_INTEGER* iterations = nullptr;
    PKCS12_get0_mac(&mac, &algorithm, &salt, &iterations, p12);
    const ASN1_OBJECT* object = nullptr;
    X509_ALGOR_get0(&object, nullptr, nullptr, algorithm);
    if (OBJ_obj2nid(object) == NID_pbmac1) return objectName(object) + " using PBKDF2";
    return objectName(object) + ", Iteration " + std::to_string(iterations ? ASN1_INTEGER_get(iterations) : 1L);
}

inline std::string bagText(const PKCS12_SAFEBAG* bag) {
    switch (PKCS12_SAFEBAG_get_nid(bag)) {
        case NID_keyBag: return "Key bag";
        case NID_pkcs8ShroudedKeyBag: {
            const X509_ALGOR* algorithm = nullptr;
            X509_SIG_get0(PKCS12_SAFEBAG_get0_pkcs8(bag), &algorithm, nullptr);
            return "Shrouded Keybag: " + algorithmText(algorithm);
        }
        case NID_certBag: return "Certificate bag";
        case NID_secretBag: return "Secret bag";
        case NID_safeContentsBag: return "Safe Contents bag";
        default: return "Warning unsupported bag type: " + objectName(PKCS12_SAFEBAG_get0_type(bag));
    }
}

// Every part of the file with what protects it, in the order `openssl pkcs12 -info` lists them.
// Encrypted parts are opened with the password to list the bags inside.
inline std::vector<std::string> safesText(PKCS12* p12, const std::string& password) {
    std::vector<std::string> lines;
    STACK_OF(PKCS7)* safes = PKCS12_unpack_authsafes(p12);
    for (int i = 0; i < sk_PKCS7_num(safes); i += 1) {
        PKCS7* safe = sk_PKCS7_value(safes, i);
        STACK_OF(PKCS12_SAFEBAG)* bags = nullptr;
        const int type = OBJ_obj2nid(safe->type);
        if (type == NID_pkcs7_data) {
            lines.push_back("PKCS7 Data");
            bags = PKCS12_unpack_p7data(safe);
        } else if (type == NID_pkcs7_encrypted) {
            lines.push_back("PKCS7 Encrypted data: " + algorithmText(safe->d.encrypted->enc_data->algorithm));
            bags = PKCS12_unpack_p7encdata(safe, password.c_str(), -1);
        } else {
            lines.push_back("Unknown PKCS7 part: " + objectName(safe->type));
        }
        for (int j = 0; j < sk_PKCS12_SAFEBAG_num(bags); j += 1) lines.push_back(bagText(sk_PKCS12_SAFEBAG_value(bags, j)));
        sk_PKCS12_SAFEBAG_pop_free(bags, PKCS12_SAFEBAG_free);
    }
    sk_PKCS7_pop_free(safes, PKCS7_free);
    ERR_clear_error();
    return lines;
}

// "modern" is what OpenSSL 3 and later write by default: AES-256-CBC under PBKDF2 with
// HMAC-SHA256 for keys and certificates, and a SHA-256 MAC. "legacy" is what `openssl pkcs12
// -legacy` writes for old Windows, macOS and Java: RC2-40 for certificates, 3DES for the key, a
// SHA-1 MAC.
inline Pkcs12 makePkcs12(EVP_PKEY* key, X509* cert, const std::vector<Cert>& chain, const std::string& password, const std::string& name, bool legacy) {
    STACK_OF(X509)* others = sk_X509_new_null();
    for (const Cert& extra : chain) sk_X509_push(others, extra.get());
    const int keyCipher = legacy ? NID_pbe_WithSHA1And3_Key_TripleDES_CBC : NID_aes_256_cbc;
    const int certCipher = legacy ? NID_pbe_WithSHA1And40BitRC2_CBC : NID_aes_256_cbc;
    PKCS12* p12 = PKCS12_create_ex2(password.c_str(), name.empty() ? nullptr : name.c_str(), key, cert, others, keyCipher, certCipher,
                                    PKCS12_DEFAULT_ITER, -1, 0, nullptr, nullptr, nullptr, nullptr);
    sk_X509_free(others);
    if (!p12) fail("cannot make the PKCS#12 file");
    Pkcs12 owned(p12);
    if (!PKCS12_set_mac(p12, password.c_str(), -1, nullptr, 0, PKCS12_DEFAULT_ITER, legacy ? EVP_sha1() : EVP_sha256())) fail("cannot add the PKCS#12 MAC");
    return owned;
}

}  // namespace sslapp
