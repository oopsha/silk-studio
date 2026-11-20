#include "7zip/Common/RegisterCodec.h"
#include "7zip/Compress/DeflateDecoder.h"
#include "7zip/Compress/DeflateEncoder.h"
#include <zlib-ng.h>
#include <future>
#include <deque>
#include <thread>
#include <stdexcept>

namespace SilkDeflate {
struct Block {
  std::vector<Byte> bytes;
  UInt64 input_size;
};

class Encoder final : public ICompressCoder, public ICompressSetCoderProperties,
                      public CMyUnknownImp {
  Z7_IFACES_IMP_UNK_2(ICompressCoder, ICompressSetCoderProperties)
  unsigned level_ = 3;
};

Z7_COM7F_IMF(Encoder::SetCoderProperties(const PROPID *ids,
    const PROPVARIANT *values, UInt32 count)) {
  for (UInt32 i = 0; i < count; ++i) {
    if (ids[i] == NCoderPropID::kLevel && values[i].vt == VT_UI4)
      level_ = values[i].ulVal == 1 ? 3 : values[i].ulVal;
  }
  return S_OK;
}

static Block Compress(std::vector<Byte> data, std::vector<Byte> dictionary,
                      unsigned level) {
  // Reassess each block so compressible regions later in a file still benefit.
  if (level != 0 && data.size() >= 128 * 1024) {
    bool compressible = false;
    for (unsigned i = 0; i < 3; ++i) {
      const size_t offset = (data.size() - 16384) / 2 * i;
      Block sample = Compress(std::vector<Byte>(data.begin() + offset,
          data.begin() + offset + 16384), {}, 1);
      if (sample.bytes.size() < sample.input_size * 995 / 1000) {
        compressible = true;
        break;
      }
    }
    if (!compressible) level = 0;
  }
  zng_stream stream{};
  if (zng_deflateInit2(&stream, level, Z_DEFLATED, -15, 8,
                      Z_DEFAULT_STRATEGY) != Z_OK)
    throw std::runtime_error("Deflate initialization failed");
  struct Cleanup {
    zng_stream *stream;
    ~Cleanup() { zng_deflateEnd(stream); }
  } cleanup{&stream};
  if (!dictionary.empty() && zng_deflateSetDictionary(&stream,
      dictionary.data(), static_cast<unsigned>(dictionary.size())) != Z_OK)
    throw std::runtime_error("Deflate dictionary failed");
  Block block{std::vector<Byte>(zng_deflateBound(&stream, data.size()) + 64),
              data.size()};
  stream.next_in = data.data();
  stream.avail_in = static_cast<unsigned>(data.size());
  stream.next_out = block.bytes.data();
  stream.avail_out = static_cast<unsigned>(block.bytes.size());
  // Byte-aligned unfinished blocks can be concatenated into one standard
  // Deflate stream. The preceding 32 KiB preserves matches across boundaries.
  if (zng_deflate(&stream, Z_SYNC_FLUSH) != Z_OK || stream.avail_in || !stream.avail_out)
    throw std::runtime_error("Deflate block failed");
  block.bytes.resize(stream.total_out);
  return block;
}

Z7_COM7F_IMF(Encoder::Code(ISequentialInStream *input,
    ISequentialOutStream *output, const UInt64 *input_size, const UInt64 *output_size,
    ICompressProgressInfo *progress)) {
  try {
    const unsigned workers = (std::min)(4u, (std::max)(1u, std::thread::hardware_concurrency() / 2));

    std::deque<std::future<Block>> pending;
    std::vector<Byte> dictionary;
    UInt64 read = 0, written = 0;
    auto emit = [&]() -> HRESULT {
      Block block = pending.front().get();
      pending.pop_front();
      size_t offset = 0;
      while (offset < block.bytes.size()) {
        UInt32 processed = 0;
        RINOK(output->Write(block.bytes.data() + offset,
            static_cast<UInt32>(block.bytes.size() - offset), &processed))
        if (!processed) return E_FAIL;
        offset += processed;
      }
      read += block.input_size;
      written += block.bytes.size();
      return progress ? progress->SetRatioInfo(&read, &written) : S_OK;
    };
    for (;;) {
      std::vector<Byte> data(1024 * 1024);
      UInt32 filled = 0;
      while (filled < data.size()) {
        UInt32 processed = 0;
        RINOK(input->Read(data.data() + filled,
            static_cast<UInt32>(data.size() - filled), &processed))
        if (!processed) break;
        filled += processed;
      }
      if (!filled) break;
      data.resize(filled);
      std::vector<Byte> next(data.end() - std::min<size_t>(32768, data.size()), data.end());
      pending.push_back(std::async(filled < 1024 * 1024 ? std::launch::deferred : std::launch::async, Compress,
          std::move(data), std::move(dictionary), level_));
      dictionary = std::move(next);
      if (pending.size() >= workers) { RINOK(emit()) }
    }
    while (!pending.empty()) { RINOK(emit()) }
    const Byte end[] = {3, 0};
    UInt32 processed = 0;
    RINOK(output->Write(end, 2, &processed))
    return processed == 2 ? S_OK : E_FAIL;
  } catch (...) { return E_FAIL; }
}

REGISTER_CODEC_CREATE(CreateDec, NCompress::NDeflate::NDecoder::CCOMCoder)
REGISTER_CODEC_CREATE(CreateEnc, Encoder)
REGISTER_CODEC_2(SilkDeflate, CreateDec, CreateEnc, 0x40108, "Deflate")
}
#pragma once

