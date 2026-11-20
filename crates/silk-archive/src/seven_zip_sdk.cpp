#include "Common/MyCom.h"
#include "Common/StringConvert.h"
#include "Windows/PropVariant.h"
#include "Windows/PropVariantConv.h"
#include "Windows/FileName.h"
#include "Windows/FileDir.h"
#include "Windows/TimeUtils.h"
#include "Windows/FileFind.h"
#include "7zip/Archive/IArchive.h"
#include "7zip/Common/FileStreams.h"
#include "7zip/IPassword.h"
#include "7zip/ICoder.h"
#include "7zip/Common/StreamUtils.h"

// SDK self-registration (formats and codecs) lives in static initializers of the
// SDK objects; build.rs links that library with whole-archive so none are dropped.
// The stock Deflate codec registration is excluded from the SDK list: SilkDeflate
// (parallel_deflate.h) registers the same codec id.

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <utility>
#include <vector>
#include <mutex>
#include <string>
#include "../C/7zCrc.h"
#include "parallel_deflate.h"

using NWindows::NCOM::CPropVariant;

struct SilkZipSdkInput {
  const char *source_path;
  const char *archive_path;
  std::uint64_t size;
  std::int64_t modified_seconds;
  int is_directory;
};

using SilkZipProgress = int (*)(std::uint64_t, std::uint64_t, std::uint32_t,
                                std::uint32_t, void *);
using SilkZipListedEntry = int (*)(const char *, std::uint64_t, int, int, int, void *);

struct SilkZipFileTiming {
  std::uint64_t opened_us;
  std::uint64_t released_us;
};

static UString from_utf8(const char *value) {
  if (!value) return UString();
  return MultiByteToUnicodeString(value, CP_UTF8);
}

static FString file_system_path(const char *value) {
  return us2fs(from_utf8(value));
}

struct ZipItem {
  UString archive_path;
  FString source_path;
  std::uint64_t size;
  std::int64_t modified_seconds;
  bool is_directory;
};

class SilkZipUpdateCallback final : public IArchiveUpdateCallback2,
                                    public ICryptoGetTextPassword2,
                                    public IInFileStream_Callback,
                                    public CMyUnknownImp {
  Z7_COM_UNKNOWN_IMP_2(IArchiveUpdateCallback2, ICryptoGetTextPassword2)

 public:
  SilkZipUpdateCallback(const std::vector<ZipItem> *items, UString password,
                        std::uint64_t total_bytes, SilkZipProgress progress,
                        void *progress_context, SilkZipFileTiming *timings)
      : items_(items), password_(std::move(password)), total_bytes_(total_bytes),
        progress_(progress), progress_context_(progress_context), timings_(timings) {}

  HRESULT InFileStream_On_Error(UINT_PTR, DWORD error) override {
    return error ? HRESULT_FROM_WIN32(error) : E_FAIL;
  }

  void InFileStream_On_Destroy(CInFileStream *, UINT_PTR index) override {
    timings_[index].released_us = elapsed_us();
  }

  Z7_COM7F_IMF(SetTotal(UInt64)) { return S_OK; }

  Z7_COM7F_IMF(SetCompleted(const UInt64 *completed)) {
    last_completed_bytes_ = completed ? *completed : 0;
    if (progress_ && progress_(last_completed_bytes_, total_bytes_,
                               completed_entries_, static_cast<std::uint32_t>(items_->size()),
                               progress_context_))
      return E_ABORT;
    return S_OK;
  }

  Z7_COM7F_IMF(GetUpdateItemInfo(UInt32, Int32 *new_data, Int32 *new_properties,
                                 UInt32 *index_in_archive)) {
    if (new_data) *new_data = 1;
    if (new_properties) *new_properties = 1;
    if (index_in_archive) *index_in_archive = static_cast<UInt32>(-1);
    return S_OK;
  }

  Z7_COM7F_IMF(GetProperty(UInt32 index, PROPID property, PROPVARIANT *value)) {
    if (!value || index >= items_->size()) return E_INVALIDARG;
    const ZipItem &item = (*items_)[index];
    CPropVariant property_value;
    switch (property) {
      case kpidIsAnti:
        property_value = false;
        break;
      case kpidPath:
        property_value = item.archive_path;
        break;
      case kpidIsDir:
        property_value = item.is_directory;
        break;
      case kpidAttrib:
#ifdef _WIN32
        if (!item.is_directory) property_value = static_cast<UInt32>(0x20);  // ARCHIVE
        else property_value = static_cast<UInt32>(0x10);                     // DIRECTORY
#else
        // ZIP written on a Unix host stores the mode in the high 16 bits (0x8000 marks it).
        if (!item.is_directory)
          property_value = static_cast<UInt32>(0x20 | 0x8000 | (0100644u << 16));
        else
          property_value = static_cast<UInt32>(0x10 | 0x8000 | (040755u << 16));
#endif
        break;
      case kpidSize:
        property_value = static_cast<UInt64>(item.is_directory ? 0 : item.size);
        break;
      case kpidMTime: {
        constexpr std::int64_t kUnixToFileTimeSeconds = 11644473600LL;
        const std::int64_t seconds = std::max<std::int64_t>(0, item.modified_seconds) +
                                     kUnixToFileTimeSeconds;
        if (seconds > 0) {
          const UInt64 ticks = static_cast<UInt64>(seconds) * 10000000ULL;
          FILETIME file_time;
          file_time.dwLowDateTime = static_cast<DWORD>(ticks);
          file_time.dwHighDateTime = static_cast<DWORD>(ticks >> 32);
          property_value = file_time;
        }
        break;
      }
      default:
        property_value.Detach(value);
        return S_OK;
    }
    property_value.Detach(value);
    return S_OK;
  }

  Z7_COM7F_IMF(GetStream(UInt32 index, ISequentialInStream **stream)) {
    if (!stream || index >= items_->size()) return E_INVALIDARG;
    *stream = nullptr;
    const ZipItem &item = (*items_)[index];
    if (item.is_directory) return S_OK;
    CInFileStream *stream_spec = new CInFileStream;
    CMyComPtr<ISequentialInStream> stream_local(stream_spec);
    if (!stream_spec->Open(item.source_path)) return E_FAIL;
    if (timings_) {
      timings_[index].opened_us = elapsed_us();
      stream_spec->CallbackRef = index;
      stream_spec->Callback = this;
    }
    *stream = stream_local.Detach();
    return S_OK;
  }

  Z7_COM7F_IMF(SetOperationResult(Int32 result)) {
    if (result != 0) return E_FAIL;
    ++completed_entries_;
    if (progress_ && progress_(last_completed_bytes_, total_bytes_, completed_entries_,
                               static_cast<std::uint32_t>(items_->size()), progress_context_))
      return E_ABORT;
    return S_OK;
  }

  Z7_COM7F_IMF(GetVolumeSize(UInt32, UInt64 *)) { return S_FALSE; }
  Z7_COM7F_IMF(GetVolumeStream(UInt32, ISequentialOutStream **)) { return E_NOTIMPL; }

  Z7_COM7F_IMF(CryptoGetTextPassword2(Int32 *password_is_defined, BSTR *password)) {
    if (!password_is_defined || !password) return E_INVALIDARG;
    *password_is_defined = password_.IsEmpty() ? 0 : 1;
    *password = nullptr;
    if (password_.IsEmpty()) return S_OK;
    return StringToBstr(password_, password);
  }

 private:
  std::uint64_t elapsed_us() const {
    // Zero indicates that the stream event was never observed.
    return 1 + std::chrono::duration_cast<std::chrono::microseconds>(
        std::chrono::steady_clock::now() - started_).count();
  }

  const std::vector<ZipItem> *items_;
  UString password_;
  std::uint64_t total_bytes_;
  SilkZipProgress progress_;
  void *progress_context_;
  SilkZipFileTiming *timings_;
  const std::chrono::steady_clock::time_point started_ = std::chrono::steady_clock::now();
  std::uint32_t completed_entries_ = 0;
  std::uint64_t last_completed_bytes_ = 0;
};

static GUID archive_format_clsid(Byte format_id) {
  return GUID{0x23170F69, 0x40C1, 0x278A,
              {0x10, 0x00, 0x00, 0x01, 0x10, format_id, 0x00, 0x00}};
}
static const GUID CLSID_SilkZipFormat = archive_format_clsid(0x01);
static const GUID CLSID_SilkTarFormat = archive_format_clsid(0xEE);
static const GUID CLSID_SilkXzFormat = archive_format_clsid(0x0C);
static const GUID CLSID_Silk7zFormat = archive_format_clsid(0x07);

class SilkZipOpenCallback final : public IArchiveOpenCallback,
                                  public IArchiveOpenVolumeCallback,
                                  public ICryptoGetTextPassword,
                                  public CMyUnknownImp {
  Z7_COM_UNKNOWN_IMP_3(IArchiveOpenCallback, IArchiveOpenVolumeCallback, ICryptoGetTextPassword)

 public:
  bool password_requested = false;
  UString password;

  Z7_COM7F_IMF(CryptoGetTextPassword(BSTR *value)) {
    if (!value) return E_INVALIDARG;
    *value = nullptr;
    if (password.IsEmpty()) {
      password_requested = true;
      return E_ABORT;
    }
    return StringToBstr(password, value);
  }

  explicit SilkZipOpenCallback(FString archive_path)
      : archive_path_(std::move(archive_path)) {
    const int separator = NWindows::NFile::NName::FindSepar(archive_path_.Ptr());
    if (separator >= 0) {
      parent_path_ = archive_path_.Left(static_cast<unsigned>(separator + 1));
      archive_name_ = archive_path_.Ptr() + separator + 1;
    } else {
      archive_name_ = archive_path_;
    }
    NWindows::NFile::NName::NormalizeDirPathPrefix(parent_path_);
  }

  Z7_COM7F_IMF(SetTotal(const UInt64 *, const UInt64 *)) { return S_OK; }
  Z7_COM7F_IMF(SetCompleted(const UInt64 *, const UInt64 *)) { return S_OK; }

  Z7_COM7F_IMF(GetProperty(PROPID property, PROPVARIANT *value)) {
    if (!value) return E_INVALIDARG;
    CPropVariant property_value;
    if (property == kpidName) property_value = fs2us(archive_name_);
    property_value.Detach(value);
    return S_OK;
  }

  Z7_COM7F_IMF(GetStream(const wchar_t *name, IInStream **stream)) {
    if (!name || !stream) return E_INVALIDARG;
    *stream = nullptr;
    UString volume_name(name);
    if (volume_name.IsEmpty() || volume_name.Find(L'/') >= 0 ||
        volume_name.Find(L'\\') >= 0 || volume_name.Find(L":") >= 0 ||
        (volume_name.Len() == 1 && volume_name[0] == L'.') ||
        (volume_name.Len() == 2 && volume_name[0] == L'.' && volume_name[1] == L'.'))
      return S_FALSE;

    FString full_path;
    const FString relative_path = us2fs(volume_name);
    if (!NWindows::NFile::NName::GetFullPath(parent_path_.Ptr(), relative_path, full_path))
      return S_FALSE;
    CInFileStream *file_spec = new CInFileStream;
    CMyComPtr<IInStream> file_stream = file_spec;
    if (!file_spec->Open(full_path)) return S_FALSE;
    *stream = file_stream.Detach();
    return S_OK;
  }

 private:
  FString archive_path_;
  FString parent_path_;
  FString archive_name_;
};

STDAPI CreateObject(const GUID *clsid, const GUID *iid, void **outObject);

// format: 0 = ZIP, 1 = TAR (uncompressed), 2 = XZ (single file, LZMA2), 3 = 7Z (LZMA2, optional AES).
extern "C" int silk_7zip_create_archive(std::uint32_t format,
                                     const char *output_path,
                                     const SilkZipSdkInput *inputs,
                                     std::uint32_t input_count,
                                     std::uint32_t compression_level,
                                     const char *password,
                                     std::uint64_t total_bytes,
                                     SilkZipProgress progress,
                                     void *progress_context,
                                     SilkZipFileTiming *timings) {
  if (!output_path || (!inputs && input_count != 0)) return static_cast<int>(E_INVALIDARG);

  std::vector<ZipItem> items;
  items.reserve(input_count);
  for (std::uint32_t i = 0; i < input_count; ++i) {
    UString archive_path = from_utf8(inputs[i].archive_path);
    if (archive_path.IsEmpty()) return static_cast<int>(E_INVALIDARG);
    items.push_back(ZipItem{std::move(archive_path), file_system_path(inputs[i].source_path),
                            inputs[i].size, inputs[i].modified_seconds,
                            inputs[i].is_directory != 0});
  }

  const FString native_output_path = file_system_path(output_path);
  static std::once_flag crc_initialized;
  std::call_once(crc_initialized, CrcGenerateTable);
  COutFileStream *output_spec = new COutFileStream;
  CMyComPtr<IOutStream> output_stream = output_spec;
  if (!output_spec->Create_ALWAYS(native_output_path)) return static_cast<int>(E_FAIL);

  CMyComPtr<IOutArchive> archive;
  if (format > 3) return static_cast<int>(E_INVALIDARG);
  const GUID *clsid = format == 1 ? &CLSID_SilkTarFormat
                    : format == 2 ? &CLSID_SilkXzFormat
                    : format == 3 ? &CLSID_Silk7zFormat : &CLSID_SilkZipFormat;
  HRESULT result = CreateObject(clsid, &IID_IOutArchive, reinterpret_cast<void **>(&archive));
  if (result != S_OK) return static_cast<int>(result);

  if (format == 0) {
    CMyComPtr<ISetProperties> set_properties;
    result = archive->QueryInterface(IID_ISetProperties,
                                     reinterpret_cast<void **>(&set_properties));
    if (result != S_OK) return static_cast<int>(result);

    const wchar_t *property_names[] = {L"m", L"x", L"em", L"cu", L"mt"};
    CPropVariant property_values[5];
    property_values[0] = L"Deflate";
    property_values[1] = static_cast<UInt32>(compression_level);
    property_values[2] = L"ZipCrypto";
    property_values[3] = true;
    property_values[4] = static_cast<UInt32>(2);
    result = set_properties->SetProperties(property_names, property_values, 5);
    if (result != S_OK) return static_cast<int>(result);
  } else if (format == 3) {
    CMyComPtr<ISetProperties> set_properties;
    result = archive->QueryInterface(IID_ISetProperties,
                                     reinterpret_cast<void **>(&set_properties));
    if (result != S_OK) return static_cast<int>(result);
    // Same reasoning as XZ: without an explicit LZMA2 block size, levels 6 and 9 compress
    // one huge block on a single thread.
    const wchar_t *property_names[] = {L"x", L"c4m", L"he"};
    CPropVariant property_values[3];
    property_values[0] = static_cast<UInt32>(compression_level);
    property_values[2] = true;  // hide file names when a password is set
    const bool encrypted = password && *password;
    UInt32 count = 1;
    if (compression_level >= 6) {
      count = 2;
      if (encrypted) count = 3;
    } else if (encrypted) {
      property_names[1] = L"he";
      property_values[1] = true;
      count = 2;
    }
    result = set_properties->SetProperties(property_names, property_values, count);
    if (result != S_OK) return static_cast<int>(result);
  } else if (format == 2) {
    CMyComPtr<ISetProperties> set_properties;
    result = archive->QueryInterface(IID_ISetProperties,
                                     reinterpret_cast<void **>(&set_properties));
    if (result != S_OK) return static_cast<int>(result);
    // At normal and maximum levels LZMA2 would otherwise emit a single block of up
    // to 4x the dictionary, which cannot be compressed in parallel. 4 MiB blocks
    // let every core work (about 2% larger output, roughly 10x faster on 24 cores).
    const wchar_t *property_names[] = {L"x", L"s4m"};
    CPropVariant property_values[2];
    property_values[0] = static_cast<UInt32>(compression_level);
    result = set_properties->SetProperties(property_names, property_values,
                                           compression_level >= 6 ? 2 : 1);
    if (result != S_OK) return static_cast<int>(result);
  }

  const UString password_string = from_utf8(password ? password : "");
  SilkZipUpdateCallback *callback_spec = new SilkZipUpdateCallback(
      &items, password_string, total_bytes, progress, progress_context, timings);
  CMyComPtr<IArchiveUpdateCallback> callback = callback_spec;
  result = archive->UpdateItems(output_stream, input_count, callback);
  if (result == S_OK && output_spec->Close() != S_OK) result = E_FAIL;
  return static_cast<int>(result);
}

namespace {
// Pass-through input that accumulates the gzip trailer CRC and size.
class CrcInStream final : public ISequentialInStream, public CMyUnknownImp {
  Z7_IFACES_IMP_UNK_1(ISequentialInStream)
 public:
  CMyComPtr<ISequentialInStream> inner;
  UInt32 crc = CRC_INIT_VAL;
  UInt64 size = 0;
};

Z7_COM7F_IMF(CrcInStream::Read(void *data, UInt32 count, UInt32 *processed)) {
  UInt32 read = 0;
  const HRESULT result = inner->Read(data, count, &read);
  crc = CrcUpdate(crc, data, read);
  size += read;
  if (processed) *processed = read;
  return result;
}

class GzipProgress final : public ICompressProgressInfo, public CMyUnknownImp {
  Z7_IFACES_IMP_UNK_1(ICompressProgressInfo)
 public:
  std::uint64_t total_bytes = 0;
  SilkZipProgress callback = nullptr;
  void *context = nullptr;
};

Z7_COM7F_IMF(GzipProgress::SetRatioInfo(const UInt64 *in_size, const UInt64 *)) {
  if (callback && in_size && callback(*in_size, total_bytes, 0, 1, context)) return E_ABORT;
  return S_OK;
}

void put_u32_le(Byte *out, UInt32 value) {
  for (int i = 0; i < 4; ++i) out[i] = static_cast<Byte>(value >> (8 * i));
}
}  // namespace

// Writes one gzip member: header, raw Deflate from the parallel encoder, CRC32 and
// ISIZE. `name` may be null; level is 1 (fast), 6 or 9.
extern "C" int silk_7zip_gzip_file(const char *input_path, const char *output_path,
                                    const char *name, std::int64_t modified_seconds,
                                    std::uint32_t level, std::uint64_t total_bytes,
                                    SilkZipProgress progress, void *progress_context) {
  if (!input_path || !output_path) return static_cast<int>(E_INVALIDARG);
  static std::once_flag crc_initialized;
  std::call_once(crc_initialized, CrcGenerateTable);

  CInFileStream *input_spec = new CInFileStream;
  CMyComPtr<ISequentialInStream> input_file = input_spec;
  if (!input_spec->Open(file_system_path(input_path))) return static_cast<int>(E_FAIL);
  COutFileStream *output_spec = new COutFileStream;
  CMyComPtr<ISequentialOutStream> output = output_spec;
  if (!output_spec->Create_ALWAYS(file_system_path(output_path))) return static_cast<int>(E_FAIL);

  const std::string file_name = name ? name : "";
  Byte header[10] = {0x1f, 0x8b, 8, static_cast<Byte>(file_name.empty() ? 0 : 8)};
  put_u32_le(header + 4, static_cast<UInt32>(
      std::clamp<std::int64_t>(modified_seconds, 0, 0xFFFFFFFFLL)));
  header[8] = level >= 9 ? 2 : level <= 1 ? 4 : 0;
  header[9] = 255;
  HRESULT result = WriteStream(output, header, sizeof(header));
  if (result == S_OK && !file_name.empty())
    result = WriteStream(output, file_name.c_str(), file_name.size() + 1);
  if (result != S_OK) return static_cast<int>(result);

  CrcInStream *crc_spec = new CrcInStream;
  CMyComPtr<ISequentialInStream> crc_stream = crc_spec;
  crc_spec->inner = input_file;
  GzipProgress *progress_spec = new GzipProgress;
  CMyComPtr<ICompressProgressInfo> progress_info = progress_spec;
  progress_spec->total_bytes = total_bytes;
  progress_spec->callback = progress;
  progress_spec->context = progress_context;

  SilkDeflate::Encoder *encoder_spec = new SilkDeflate::Encoder;
  CMyComPtr<ICompressCoder> encoder = encoder_spec;
  PROPID level_id = NCoderPropID::kLevel;
  CPropVariant level_value;
  level_value = static_cast<UInt32>(level);
  result = static_cast<ICompressSetCoderProperties *>(encoder_spec)
               ->SetCoderProperties(&level_id, &level_value, 1);
  if (result != S_OK) return static_cast<int>(result);
  result = encoder->Code(crc_stream, output, nullptr, nullptr, progress_info);
  if (result != S_OK) return static_cast<int>(result);

  Byte trailer[8];
  put_u32_le(trailer, CRC_GET_DIGEST(crc_spec->crc));
  put_u32_le(trailer + 4, static_cast<UInt32>(crc_spec->size));
  result = WriteStream(output, trailer, sizeof(trailer));
  if (result == S_OK && output_spec->Close() != S_OK) result = E_FAIL;
  return static_cast<int>(result);
}

extern "C" int silk_7zip_list_split_zip(const char *archive_path,
                                          SilkZipListedEntry entry_callback,
                                          void *entry_context) {
  if (!archive_path || !entry_callback) return static_cast<int>(E_INVALIDARG);
  const FString native_archive_path = file_system_path(archive_path);
  CInFileStream *input_spec = new CInFileStream;
  CMyComPtr<IInStream> input_stream = input_spec;
  if (!input_spec->Open(native_archive_path)) return static_cast<int>(E_FAIL);

  CMyComPtr<IInArchive> archive;
  HRESULT result = CreateObject(&CLSID_SilkZipFormat, &IID_IInArchive,
                                reinterpret_cast<void **>(&archive));
  if (result != S_OK) return static_cast<int>(result);
  SilkZipOpenCallback *callback_spec = new SilkZipOpenCallback(native_archive_path);
  CMyComPtr<IArchiveOpenCallback> callback = callback_spec;
  result = archive->Open(input_stream, nullptr, callback);
  if (result != S_OK) return static_cast<int>(result);

  UInt32 item_count = 0;
  result = archive->GetNumberOfItems(&item_count);
  for (UInt32 index = 0; result == S_OK && index < item_count; ++index) {
    CPropVariant path_value;
    CPropVariant size_value;
    CPropVariant directory_value;
    CPropVariant encrypted_value;
    result = archive->GetProperty(index, kpidPath, &path_value);
    if (result == S_OK) result = archive->GetProperty(index, kpidSize, &size_value);
    if (result == S_OK) result = archive->GetProperty(index, kpidIsDir, &directory_value);
    if (result == S_OK) result = archive->GetProperty(index, kpidEncrypted, &encrypted_value);
    if (result != S_OK) break;
    if (path_value.vt != VT_BSTR) {
      result = E_FAIL;
      break;
    }

    bool conversion_failed = false;
    AString utf8_path = UnicodeStringToMultiByte(UString(path_value.bstrVal), CP_UTF8, '?', conversion_failed);
    if (conversion_failed) {
      result = E_FAIL;
      break;
    }
    UInt64 size = 0;
    const int size_is_set = ConvertPropVariantToUInt64(size_value, size) ? 1 : 0;
    const int is_directory = directory_value.vt == VT_BOOL && directory_value.boolVal != VARIANT_FALSE;
    const int is_encrypted = encrypted_value.vt == VT_BOOL && encrypted_value.boolVal != VARIANT_FALSE;
    if (entry_callback(utf8_path.Ptr(), size, size_is_set, is_directory, is_encrypted,
                       entry_context) != 0) {
      result = E_ABORT;
      break;
    }
  }
  const HRESULT close_result = archive->Close();
  if (result == S_OK && close_result != S_OK) result = close_result;
  return static_cast<int>(result);
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

STDAPI GetNumberOfFormats(UINT32 *numFormats);
STDAPI GetHandlerProperty2(UInt32 formatIndex, PROPID propID, PROPVARIANT *value);

struct SilkExtractResult {
  std::uint32_t extracted;
  std::uint32_t skipped;
  std::uint32_t failed;
  std::int32_t first_error;    // NExtract::NOperationResult of the first failed item
  std::int32_t need_password;  // 1 when a password was required but missing
  char format[32];
  char message[256];
};

namespace {

UString lower_extension(const UString &name) {
  const int dot = name.ReverseFind(L'.');
  if (dot < 0) return UString();
  UString ext(name.Ptr() + dot + 1);
  ext.MakeLower_Ascii();
  return ext;
}

bool extension_listed(const UString &list, const UString &ext) {
  if (ext.IsEmpty()) return false;
  UString token;
  for (unsigned i = 0; i <= list.Len(); ++i) {
    if (i == list.Len() || list[i] == L' ') {
      if (token == ext) return true;
      token.Empty();
    } else {
      token += list[i];
    }
  }
  return false;
}

struct OpenedArchive {
  CMyComPtr<IInArchive> archive;
  CMyComPtr<IInArchive> outer;  // keeps a split container alive
  CMyComPtr<IInStream> stream;  // stream the archive was opened on
  AString format;
};

// Tries every registered format: extension matches first, then formats with a
// signature, then the rest. `allow_split` lets a ".001" volume open through the Split handler.
HRESULT open_detected(IInStream *stream, const UString &file_name, IArchiveOpenCallback *callback,
                      bool allow_split, OpenedArchive &out) {
  UInt32 count = 0;
  HRESULT result = GetNumberOfFormats(&count);
  if (result != S_OK) return result;
  const UString ext = lower_extension(file_name);

  struct Candidate { UInt32 index; int rank; };
  std::vector<Candidate> candidates;
  for (UInt32 i = 0; i < count; ++i) {
    CPropVariant name, extensions, signature, multi;
    GetHandlerProperty2(i, NArchive::NHandlerPropID::kName, &name);
    GetHandlerProperty2(i, NArchive::NHandlerPropID::kExtension, &extensions);
    GetHandlerProperty2(i, NArchive::NHandlerPropID::kSignature, &signature);
    GetHandlerProperty2(i, NArchive::NHandlerPropID::kMultiSignature, &multi);
    const bool is_split = name.vt == VT_BSTR && UString(name.bstrVal) == L"Split";
    if (is_split && !allow_split) continue;
    int rank = 2;
    if (extensions.vt == VT_BSTR && extension_listed(UString(extensions.bstrVal), ext)) rank = 0;
    else if (signature.vt == VT_BSTR || multi.vt == VT_BSTR) rank = 1;
    if (is_split && rank != 0) continue;  // only for numbered volumes
    candidates.push_back({i, rank});
  }
  std::stable_sort(candidates.begin(), candidates.end(),
                   [](const Candidate &a, const Candidate &b) { return a.rank < b.rank; });

  for (const Candidate &candidate : candidates) {
    CPropVariant class_id, name;
    if (GetHandlerProperty2(candidate.index, NArchive::NHandlerPropID::kClassID, &class_id) != S_OK ||
        class_id.vt != VT_BSTR)
      continue;
    GUID clsid;
    memcpy(&clsid, class_id.bstrVal, sizeof(clsid));
    CMyComPtr<IInArchive> archive;
    if (CreateObject(&clsid, &IID_IInArchive, reinterpret_cast<void **>(&archive)) != S_OK) continue;
    UInt64 position = 0;
    if (stream->Seek(0, STREAM_SEEK_SET, &position) != S_OK) return E_FAIL;
    const UInt64 max_start = 0;
    result = archive->Open(stream, &max_start, callback);
    if (result == E_ABORT) return result;
    if (result != S_OK) continue;
    GetHandlerProperty2(candidate.index, NArchive::NHandlerPropID::kName, &name);
    AString format_name;
    if (name.vt == VT_BSTR) format_name = UnicodeStringToMultiByte(UString(name.bstrVal));
    if (format_name == "Split") {
      CMyComPtr<IInArchiveGetStream> get_stream;
      CMyComPtr<ISequentialInStream> inner;
      if (archive->QueryInterface(IID_IInArchiveGetStream, reinterpret_cast<void **>(&get_stream)) != S_OK ||
          get_stream->GetStream(0, &inner) != S_OK || !inner)
        continue;
      CMyComPtr<IInStream> inner_stream;
      if (inner.QueryInterface(IID_IInStream, &inner_stream) != S_OK) continue;
      UString inner_name = file_name;
      const int dot = inner_name.ReverseFind(L'.');
      if (dot > 0) inner_name.DeleteFrom(static_cast<unsigned>(dot));
      OpenedArchive nested;
      result = open_detected(inner_stream, inner_name, callback, false, nested);
      if (result != S_OK) return result;
      nested.outer = archive;
      out = nested;
      return S_OK;
    }
    out.archive = archive;
    out.stream = stream;
    out.format = format_name;
    return S_OK;
  }
  return S_FALSE;
}

#ifdef _WIN32
// Zip names without the UTF-8 flag are decoded with the OEM code page, which turns
// UTF-8 names written by many tools into garbage (or names Windows rejects). When
// every name is valid UTF-8, decode them as UTF-8; otherwise keep the OEM default.
static void prefer_utf8_zip_names(IInArchive *archive, UInt32 items) {
  CMyComPtr<ISetProperties> setter;
  if (archive->QueryInterface(IID_ISetProperties, reinterpret_cast<void **>(&setter)) != S_OK ||
      !setter)
    return;
  const wchar_t *names[] = {L"cp"};
  NWindows::NCOM::CPropVariant value;
  value = static_cast<UInt32>(65001);
  PROPVARIANT variant = value;
  if (setter->SetProperties(names, &variant, 1) != S_OK) return;
  bool non_ascii = false;
  bool valid = true;
  for (UInt32 i = 0; i < items && valid; ++i) {
    CPropVariant path;
    if (archive->GetProperty(i, kpidPath, &path) != S_OK || path.vt != VT_BSTR) continue;
    for (const wchar_t *c = path.bstrVal; *c; ++c) {
      if (*c == 0xFFFD) { valid = false; break; }
      if (*c > 0x7F) non_ascii = true;
    }
  }
  if (valid && non_ascii) return;
  value = static_cast<UInt32>(CP_OEMCP);
  variant = value;
  setter->SetProperties(names, &variant, 1);
}
#endif


// Normalises an archive path for comparison with a selection.
static UString normalize_archive_path(const UString &path) {
  UString result;
  for (unsigned i = 0; i < path.Len(); ++i) result += static_cast<wchar_t>(path[i] == L'\\' ? L'/' : path[i]);
  while (result.Len() > 0 && result.Back() == L'/') result.DeleteBack();
  while (result.Len() >= 2 && result[0] == L'.' && result[1] == L'/') result.DeleteFrontal(2);
  return result;
}

// Length of the selection that contains `path`, or -1. A selection matches itself and
// everything below it.
static int selection_index(const std::vector<UString> &selections, const UString &path) {
  const UString normalized = normalize_archive_path(path);
  for (size_t i = 0; i < selections.size(); ++i) {
    const UString &selection = selections[i];
    if (normalized == selection) return static_cast<int>(i);
    if (normalized.Len() > selection.Len() && normalized[selection.Len()] == L'/' &&
        normalized.IsPrefixedBy(selection.Ptr()))
      return static_cast<int>(i);
  }
  return -1;
}

class SilkExtractCallback final : public IArchiveExtractCallback,
                                  public ICryptoGetTextPassword,
                                  public CMyUnknownImp {
  Z7_COM_UNKNOWN_IMP_2(IArchiveExtractCallback, ICryptoGetTextPassword)

 public:
  SilkExtractCallback(IInArchive *archive, FString destination, UString fallback_name,
                      UString password, bool overwrite, UInt32 total_items,
                      SilkZipProgress progress, void *progress_context, SilkExtractResult *result)
      : archive_(archive), destination_(std::move(destination)),
        fallback_name_(std::move(fallback_name)), password_(std::move(password)),
        overwrite_(overwrite), total_items_(total_items), progress_(progress),
        progress_context_(progress_context), result_(result) {}

  // Normalised ("/" separators, no trailing slash) archive paths chosen for extraction.
  std::vector<UString> selections;
  bool test_only = false;

  Z7_COM7F_IMF(SetTotal(UInt64 total)) { total_ = total; return S_OK; }

  Z7_COM7F_IMF(SetCompleted(const UInt64 *completed)) {
    completed_ = completed ? *completed : 0;
    if (progress_ && progress_(completed_, total_, done_, total_items_, progress_context_))
      return E_ABORT;
    return S_OK;
  }

  Z7_COM7F_IMF(GetStream(UInt32 index, ISequentialOutStream **stream, Int32 mode)) {
    *stream = nullptr;
    current_.Empty();
    out_spec_ = nullptr;
    out_stream_.Release();
    skipped_item_ = false;
    is_dir_ = false;
    if (test_only) {
      // Integrity test: no output stream, the data is only decoded and checked.
      CPropVariant dir_value;
      archive_->GetProperty(index, kpidIsDir, &dir_value);
      skipped_item_ = dir_value.vt == VT_BOOL && dir_value.boolVal != VARIANT_FALSE;
      return S_OK;
    }
    if (mode != NArchive::NExtract::NAskMode::kExtract) {
      skipped_item_ = true;
      return S_OK;
    }

    CPropVariant path_value, dir_value, posix_value, attrib_value, time_value;
    archive_->GetProperty(index, kpidPath, &path_value);
    archive_->GetProperty(index, kpidIsDir, &dir_value);
    archive_->GetProperty(index, kpidPosixAttrib, &posix_value);
    archive_->GetProperty(index, kpidAttrib, &attrib_value);
    archive_->GetProperty(index, kpidMTime, &time_value);
    const bool is_dir = dir_value.vt == VT_BOOL && dir_value.boolVal != VARIANT_FALSE;

    UString path = path_value.vt == VT_BSTR ? UString(path_value.bstrVal) : fallback_name_;
    if (path.IsEmpty()) path = fallback_name_;
    if (!selections.empty()) path = relative_to_selection(path);
    FString full;
    if (!safe_target(path, full)) {
      fail("unsafe_path");
      skipped_item_ = true;
      ++result_->failed;
      return S_OK;
    }
    const UInt32 posix = posix_value.vt == VT_UI4 ? posix_value.ulVal : 0;
    const UInt32 attrib = attrib_value.vt == VT_UI4 ? attrib_value.ulVal : 0;
    if (((posix >> 16) & 0170000) == 0120000 || (posix & 0170000) == 0120000 ||
        (attrib & 0x400) != 0) {  // symlink / reparse point
      skipped_item_ = true;
      ++result_->skipped;
      return S_OK;
    }
    if (is_dir) {
      NWindows::NFile::NDir::CreateComplexDir(full);
      is_dir_ = true;
      return S_OK;
    }
    const int separator = NWindows::NFile::NName::FindSepar(full.Ptr());
    (void)separator;
    int last = -1;
    for (unsigned i = 0; i < full.Len(); ++i)
      if (IS_PATH_SEPAR(full[i])) last = static_cast<int>(i);
    if (last > 0) NWindows::NFile::NDir::CreateComplexDir(full.Left(static_cast<unsigned>(last)));
    NWindows::NFile::NFind::CFileInfo info;
    if (!overwrite_ && info.Find(full)) {
      skipped_item_ = true;
      ++result_->skipped;
      return S_OK;
    }
    out_spec_ = new COutFileStream;
    out_stream_ = out_spec_;
    if (!out_spec_->Create_ALWAYS(full)) {
      out_stream_.Release();
      out_spec_ = nullptr;
      fail("create_failed");
      skipped_item_ = true;
      ++result_->failed;
      return S_OK;
    }
    current_ = full;
    if (time_value.vt == VT_FILETIME) {
      modified_ = time_value.filetime;
      has_time_ = true;
    } else {
      has_time_ = false;
    }
    CMyComPtr<ISequentialOutStream> handed = out_stream_;
    *stream = handed.Detach();
    return S_OK;
  }

  Z7_COM7F_IMF(PrepareOperation(Int32)) { return S_OK; }

  Z7_COM7F_IMF(SetOperationResult(Int32 op_result)) {
    if (out_spec_) {
      if (has_time_) {
        CFiTime modified_time;
#ifdef _WIN32
        modified_time = modified_;
        const bool converted = true;
#else
        const bool converted = FILETIME_To_timespec(modified_, modified_time);
#endif
        if (converted) out_spec_->SetMTime(&modified_time);
      }
      out_spec_->Close();
      out_spec_ = nullptr;
      out_stream_.Release();
    }
    if (!skipped_item_) {
      if (op_result == NArchive::NExtract::NOperationResult::kOK) {
        ++result_->extracted;
      } else {
        ++result_->failed;
        if (result_->first_error == 0) result_->first_error = op_result;
        if (!current_.IsEmpty()) NWindows::NFile::NDir::DeleteFileAlways(current_);
      }
    }
    ++done_;
    if (progress_ && progress_(completed_, total_, done_, total_items_, progress_context_))
      return E_ABORT;
    return S_OK;
  }

  Z7_COM7F_IMF(CryptoGetTextPassword(BSTR *value)) {
    if (!value) return E_INVALIDARG;
    *value = nullptr;
    if (password_.IsEmpty()) {
      result_->need_password = 1;
      return E_ABORT;
    }
    return StringToBstr(password_, value);
  }

 private:
  // Drops the parent folders of the matching selection so "a/b/c/x" selected via "a/b/c"
  // is written as "c/x".
  UString relative_to_selection(const UString &path) const {
    const UString normalized = normalize_archive_path(path);
    const int index = selection_index(selections, path);
    if (index < 0) return normalized;
    const UString &selection = selections[static_cast<size_t>(index)];
    const int slash = selection.ReverseFind(L'/');
    if (slash < 0) return normalized;
    return UString(normalized.Ptr(static_cast<unsigned>(slash) + 1));
  }

  void fail(const char *message) {
    if (result_->message[0] == 0) strncpy(result_->message, message, sizeof(result_->message) - 1);
  }

  // Joins `path` below the destination; rejects absolute paths, drive letters and "..".
  bool safe_target(const UString &path, FString &out) {
    FString result = destination_;
    UString part;
    bool any = false;
    for (unsigned i = 0; i <= path.Len(); ++i) {
      if (i == path.Len() || path[i] == L'/' || path[i] == L'\\') {
        if (part == L"..") return false;
        if (!part.IsEmpty() && part != L".") {
          if (part.Find(L':') >= 0) return false;
          result += FCHAR_PATH_SEPARATOR;
          result += us2fs(part);
          any = true;
        } else if (i == 0 && path.Len() > 0) {
          return false;  // absolute path
        }
        part.Empty();
      } else if (path[i] == 0) {
        return false;
      } else {
        part += path[i];
      }
    }
    out = result;
    return any;
  }

  IInArchive *archive_;
  FString destination_;
  UString fallback_name_;
  UString password_;
  bool overwrite_;
  UInt32 total_items_;
  SilkZipProgress progress_;
  void *progress_context_;
  SilkExtractResult *result_;
  FString current_;
  COutFileStream *out_spec_ = nullptr;
  CMyComPtr<ISequentialOutStream> out_stream_;
  FILETIME modified_{};
  bool has_time_ = false;
  bool is_dir_ = false;
  bool skipped_item_ = false;
  UInt64 total_ = 0;
  UInt64 completed_ = 0;
  UInt32 done_ = 0;
};

}  // namespace

// Extracts every item of `archive_path` into `output_dir`. Detects the format,
// handles numbered split volumes (.001) and encrypted headers/data.
extern "C" int silk_7zip_extract(const char *archive_path, const char *output_dir,
                                  const char *password, int overwrite, int test_only,
                                  const char *const *only, std::uint32_t only_count,
                                  SilkZipProgress progress, void *progress_context,
                                  SilkExtractResult *out) {
  if (!archive_path || !output_dir || !out) return static_cast<int>(E_INVALIDARG);
  memset(out, 0, sizeof(*out));
  static std::once_flag crc_initialized;
  std::call_once(crc_initialized, CrcGenerateTable);

  const FString native_archive = file_system_path(archive_path);
  FString destination = file_system_path(output_dir);
  while (destination.Len() > 1 && IS_PATH_SEPAR(destination.Back())) destination.DeleteBack();
  if (!test_only) NWindows::NFile::NDir::CreateComplexDir(destination);

  CInFileStream *input_spec = new CInFileStream;
  CMyComPtr<IInStream> input = input_spec;
  if (!input_spec->Open(native_archive)) return static_cast<int>(E_FAIL);
  SilkZipOpenCallback *open_spec = new SilkZipOpenCallback(native_archive);
  CMyComPtr<IArchiveOpenCallback> open_callback = open_spec;
  open_spec->password = from_utf8(password ? password : "");

  int separator = -1;
  for (unsigned i = 0; i < native_archive.Len(); ++i)
    if (IS_PATH_SEPAR(native_archive[i])) separator = static_cast<int>(i);
  UString file_name = fs2us(FString(native_archive.Ptr() + (separator >= 0 ? separator + 1 : 0)));
  OpenedArchive opened;
  HRESULT result = open_detected(input, file_name, open_callback, true, opened);
  if (open_spec->password_requested) out->need_password = 1;
  if (result != S_OK) return static_cast<int>(result);
  strncpy(out->format, opened.format.Ptr(), sizeof(out->format) - 1);

  UInt32 items = 0;
  result = opened.archive->GetNumberOfItems(&items);
  if (result != S_OK) return static_cast<int>(result);
#ifdef _WIN32
  if (opened.format.IsEqualTo_Ascii_NoCase("zip")) prefer_utf8_zip_names(opened.archive, items);
#endif
  UString fallback = file_name;
  const int dot = fallback.ReverseFind(L'.');
  if (dot > 0) fallback.DeleteFrom(static_cast<unsigned>(dot));
  if (fallback.IsEmpty()) fallback = L"extracted";

  std::vector<UString> selections;
  for (std::uint32_t i = 0; i < only_count; ++i) {
    UString selection = normalize_archive_path(from_utf8(only[i]));
    if (!selection.IsEmpty()) selections.push_back(selection);
  }
  std::vector<UInt32> indices;
  if (only_count > 0) {
    for (UInt32 i = 0; i < items; ++i) {
      CPropVariant path;
      if (opened.archive->GetProperty(i, kpidPath, &path) != S_OK || path.vt != VT_BSTR) continue;
      if (selection_index(selections, UString(path.bstrVal)) >= 0) indices.push_back(i);
    }
    if (indices.empty()) {
      strncpy(out->message, "no_match", sizeof(out->message) - 1);
      opened.archive->Close();
      return 0;
    }
  }

  SilkExtractCallback *callback_spec = new SilkExtractCallback(
      opened.archive, destination, fallback, from_utf8(password ? password : ""),
      overwrite != 0, only_count > 0 ? static_cast<UInt32>(indices.size()) : items, progress,
      progress_context, out);
  callback_spec->selections = selections;
  callback_spec->test_only = test_only != 0;
  CMyComPtr<IArchiveExtractCallback> callback = callback_spec;
  result = opened.archive->Extract(indices.empty() ? nullptr : indices.data(),
                                   indices.empty() ? static_cast<UInt32>(-1)
                                                   : static_cast<UInt32>(indices.size()),
                                   test_only ? 1 : 0, callback);
  opened.archive->Close();
  return static_cast<int>(result);
}
