#include "Common/MyCom.h"
#include "Common/StringConvert.h"
#include "Windows/PropVariant.h"
#include "Windows/PropVariantConv.h"
#include "Windows/FileName.h"
#include "7zip/Archive/IArchive.h"
#include "7zip/Common/FileStreams.h"
#include "7zip/IPassword.h"

// Keep SDK self-registration in the adapter object so static linking cannot
// discard these translation units as unreferenced archive members.
#include "7zip/Archive/Zip/ZipRegister.cpp"
#include "7zip/Compress/DeflateRegister.cpp"

#include <algorithm>
#include <cstdint>
#include <utility>
#include <vector>

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
                                    public CMyUnknownImp {
  Z7_COM_UNKNOWN_IMP_2(IArchiveUpdateCallback2, ICryptoGetTextPassword2)

 public:
  SilkZipUpdateCallback(const std::vector<ZipItem> *items, UString password,
                        std::uint64_t total_bytes, SilkZipProgress progress,
                        void *progress_context)
      : items_(items), password_(std::move(password)), total_bytes_(total_bytes),
        progress_(progress), progress_context_(progress_context) {}

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
  const std::vector<ZipItem> *items_;
  UString password_;
  std::uint64_t total_bytes_;
  SilkZipProgress progress_;
  void *progress_context_;
  std::uint32_t completed_entries_ = 0;
  std::uint64_t last_completed_bytes_ = 0;
};

static const GUID CLSID_SilkZipFormat = {
    0x23170F69, 0x40C1, 0x278A, {0x10, 0x00, 0x00, 0x01, 0x10, 0x01, 0x00, 0x00}};

class SilkZipOpenCallback final : public IArchiveOpenCallback,
                                  public IArchiveOpenVolumeCallback,
                                  public CMyUnknownImp {
  Z7_COM_UNKNOWN_IMP_2(IArchiveOpenCallback, IArchiveOpenVolumeCallback)

 public:
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

extern "C" int silk_7zip_create_zip(const char *output_path,
                                     const SilkZipSdkInput *inputs,
                                     std::uint32_t input_count,
                                     std::uint32_t compression_level,
                                     const char *password,
                                     std::uint64_t total_bytes,
                                     SilkZipProgress progress,
                                     void *progress_context) {
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
  COutFileStream *output_spec = new COutFileStream;
  CMyComPtr<IOutStream> output_stream = output_spec;
  if (!output_spec->Create_ALWAYS(native_output_path)) return static_cast<int>(E_FAIL);

  CMyComPtr<IOutArchive> archive;
  HRESULT result = CreateObject(&CLSID_SilkZipFormat, &IID_IOutArchive,
                                reinterpret_cast<void **>(&archive));
  if (result != S_OK) return static_cast<int>(result);

  CMyComPtr<ISetProperties> set_properties;
  result = archive->QueryInterface(IID_ISetProperties,
                                   reinterpret_cast<void **>(&set_properties));
  if (result != S_OK) return static_cast<int>(result);

  const wchar_t *property_names[] = {L"m", L"x", L"em", L"cu"};
  CPropVariant property_values[4];
  property_values[0] = L"Deflate";
  property_values[1] = static_cast<UInt32>(compression_level);
  property_values[2] = L"ZipCrypto";
  property_values[3] = true;
  result = set_properties->SetProperties(property_names, property_values, 4);
  if (result != S_OK) return static_cast<int>(result);

  const UString password_string = from_utf8(password ? password : "");
  SilkZipUpdateCallback *callback_spec = new SilkZipUpdateCallback(
      &items, password_string, total_bytes, progress, progress_context);
  CMyComPtr<IArchiveUpdateCallback> callback = callback_spec;
  result = archive->UpdateItems(output_stream, input_count, callback);
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
