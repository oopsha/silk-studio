package com.silk.jdbcagent;

import java.io.BufferedWriter;
import java.io.IOException;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.Deflater;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/** Streaming writers for exporting a JDBC result set to a file, one row at a time. */
interface ResultExportWriter extends AutoCloseable {
  void header(String[] labels) throws IOException;

  /**
   * @param values cell text, {@code null} for SQL NULL
   * @param numeric per column: the JDBC type is numeric (written as a number cell when it is safe)
   */
  void row(String[] values, boolean[] numeric) throws IOException;

  @Override
  void close() throws IOException;

  /** Characters written so far (only tracked by writers that need a size limit). */
  default long writtenChars() {
    return 0;
  }

  static ResultExportWriter open(String format, Path target, String nullDisplay) throws IOException {
    if ("xlsx".equalsIgnoreCase(format)) return new Xlsx(target);
    if ("tsv".equalsIgnoreCase(format)) return new Tsv(target, nullDisplay);
    return new Csv(target);
  }

  /**
   * Clipboard text: values only (no header), tab separated, LF rows, SQL NULL as the grid's null
   * token — matches the frontend's {@code toTsv(..., { includeHeader: false })}.
   */
  final class Tsv implements ResultExportWriter {
    private final Writer out;
    private final String nullDisplay;
    private final StringBuilder line = new StringBuilder(512);
    private boolean first = true;
    private long chars;

    Tsv(Path target, String nullDisplay) throws IOException {
      out = new BufferedWriter(new OutputStreamWriter(Files.newOutputStream(target), StandardCharsets.UTF_8), 1 << 16);
      this.nullDisplay = nullDisplay == null ? "" : nullDisplay;
    }

    @Override
    public void header(String[] labels) {
      // Cell copy mirrors spreadsheet behavior: values only, never headers.
    }

    @Override
    public void row(String[] values, boolean[] numeric) throws IOException {
      line.setLength(0);
      if (!first) line.append('\n');
      first = false;
      for (int i = 0; i < values.length; i++) {
        if (i > 0) line.append('\t');
        appendField(line, values[i] == null ? nullDisplay : values[i]);
      }
      chars += line.length();
      out.write(line.toString());
    }

    private static void appendField(StringBuilder out, String value) {
      boolean quote = false;
      for (int i = 0; i < value.length(); i++) {
        char ch = value.charAt(i);
        if (ch == '\t' || ch == '\n' || ch == '\r') {
          quote = true;
          break;
        }
      }
      if (!quote) {
        out.append(value);
        return;
      }
      out.append('"');
      for (int i = 0; i < value.length(); i++) {
        char ch = value.charAt(i);
        if (ch == '"') out.append('"');
        out.append(ch);
      }
      out.append('"');
    }

    @Override
    public long writtenChars() {
      return chars;
    }

    @Override
    public void close() throws IOException {
      out.close();
    }
  }

  /** UTF-8 CSV with BOM and CRLF, quoted like the frontend's {@code toCsv}. */
  final class Csv implements ResultExportWriter {
    private final Writer out;
    private final StringBuilder line = new StringBuilder(512);
    private boolean first = true;

    Csv(Path target) throws IOException {
      out = new BufferedWriter(new OutputStreamWriter(Files.newOutputStream(target), StandardCharsets.UTF_8), 1 << 16);
      out.write(0xFEFF);
    }

    @Override
    public void header(String[] labels) throws IOException {
      write(labels);
    }

    @Override
    public void row(String[] values, boolean[] numeric) throws IOException {
      write(values);
    }

    private void write(String[] values) throws IOException {
      line.setLength(0);
      if (!first) line.append("\r\n");
      first = false;
      for (int i = 0; i < values.length; i++) {
        if (i > 0) line.append(',');
        appendField(line, values[i]);
      }
      out.write(line.toString());
    }

    private static void appendField(StringBuilder out, String value) {
      if (value == null) return;
      boolean quote = false;
      for (int i = 0; i < value.length(); i++) {
        char ch = value.charAt(i);
        if (ch == ',' || ch == '"' || ch == '\n' || ch == '\r') {
          quote = true;
          break;
        }
      }
      if (!quote) {
        out.append(value);
        return;
      }
      out.append('"');
      for (int i = 0; i < value.length(); i++) {
        char ch = value.charAt(i);
        if (ch == '"') out.append('"');
        out.append(ch);
      }
      out.append('"');
    }

    @Override
    public void close() throws IOException {
      out.close();
    }
  }

  /**
   * Minimal streaming .xlsx (OOXML) writer: no third-party dependency, constant memory. Numbers
   * are written as number cells only when Excel can hold them exactly (at most 15 digits);
   * everything else is text. A new sheet is started every {@link #MAX_ROWS} rows.
   */
  final class Xlsx implements ResultExportWriter {
    static final int MAX_ROWS = 1_048_576;
    private static final int MAX_CELL_CHARS = 32_767;

    private final ZipOutputStream zip;
    private final Writer sheet;
    private final StringBuilder line = new StringBuilder(1024);
    private String[] labels = new String[0];
    private String[] columnRefs = new String[0];
    private int sheetCount = 0;
    private int rowInSheet = 0;
    private final List<String> sheetNames = new ArrayList<>();

    Xlsx(Path target) throws IOException {
      OutputStream file = Files.newOutputStream(target);
      zip = new ZipOutputStream(file, StandardCharsets.UTF_8);
      zip.setLevel(Deflater.BEST_SPEED);
      sheet = new BufferedWriter(new OutputStreamWriter(zip, StandardCharsets.UTF_8), 1 << 16);
      putStyles();
    }

    private void putStyles() throws IOException {
      zip.putNextEntry(new ZipEntry("xl/styles.xml"));
      String styles =
          "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
              + "<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">"
              + "<fonts count=\"2\"><font><sz val=\"11\"/><name val=\"Calibri\"/></font>"
              + "<font><b/><sz val=\"11\"/><name val=\"Calibri\"/></font></fonts>"
              + "<fills count=\"2\"><fill><patternFill patternType=\"none\"/></fill>"
              + "<fill><patternFill patternType=\"gray125\"/></fill></fills>"
              + "<borders count=\"1\"><border><left/><right/><top/><bottom/><diagonal/></border></borders>"
              + "<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>"
              + "<cellXfs count=\"2\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/>"
              + "<xf numFmtId=\"0\" fontId=\"1\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/></cellXfs>"
              + "<cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles>"
              + "</styleSheet>";
      zip.write(styles.getBytes(StandardCharsets.UTF_8));
      zip.closeEntry();
    }

    @Override
    public void header(String[] labels) throws IOException {
      this.labels = labels;
      columnRefs = new String[labels.length];
      for (int i = 0; i < labels.length; i++) columnRefs[i] = columnName(i);
      startSheet();
    }

    private void startSheet() throws IOException {
      sheetCount++;
      sheetNames.add("Sheet" + sheetCount);
      zip.putNextEntry(new ZipEntry("xl/worksheets/sheet" + sheetCount + ".xml"));
      StringBuilder head = new StringBuilder(1024);
      head.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>")
          .append("<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">")
          .append("<sheetViews><sheetView workbookViewId=\"0\"><pane ySplit=\"1\" topLeftCell=\"A2\" ")
          .append("activePane=\"bottomLeft\" state=\"frozen\"/></sheetView></sheetViews>")
          .append("<sheetFormatPr defaultRowHeight=\"15\"/>");
      if (labels.length > 0) {
        head.append("<cols><col min=\"1\" max=\"").append(labels.length).append("\" width=\"18\" customWidth=\"1\"/></cols>");
      }
      head.append("<sheetData>");
      sheet.write(head.toString());
      rowInSheet = 0;
      writeCells(labels, null, true);
    }

    @Override
    public void row(String[] values, boolean[] numeric) throws IOException {
      if (rowInSheet >= MAX_ROWS) {
        endSheet();
        startSheet();
      }
      writeCells(values, numeric, false);
    }

    private void writeCells(String[] values, boolean[] numeric, boolean bold) throws IOException {
      rowInSheet++;
      line.setLength(0);
      line.append("<row r=\"").append(rowInSheet).append("\">");
      for (int i = 0; i < values.length; i++) {
        String value = values[i];
        if (value == null) continue;
        line.append("<c r=\"").append(columnRefs[i]).append(rowInSheet).append('"');
        if (bold) line.append(" s=\"1\"");
        if (numeric != null && numeric[i] && isExactNumber(value)) {
          line.append("><v>").append(value).append("</v></c>");
        } else {
          line.append(" t=\"inlineStr\"><is><t xml:space=\"preserve\">");
          appendEscaped(line, value);
          line.append("</t></is></c>");
        }
      }
      line.append("</row>");
      sheet.write(line.toString());
    }

    private void endSheet() throws IOException {
      sheet.write("</sheetData></worksheet>");
      sheet.flush();
      zip.closeEntry();
    }

    /** Plain decimal text Excel stores exactly: at most 15 significant digits. */
    private static boolean isExactNumber(String value) {
      int digits = 0;
      boolean leading = true;
      for (int i = 0; i < value.length(); i++) {
        char ch = value.charAt(i);
        if (ch >= '0' && ch <= '9') {
          if (ch != '0') leading = false;
          if (!leading) digits++;
        } else if (ch != '-' && ch != '.' || (ch == '-' && i != 0)) {
          return false;
        }
      }
      return digits <= 15 && !value.isEmpty() && !value.equals("-") && !value.equals(".");
    }

    private static void appendEscaped(StringBuilder out, String value) {
      int length = Math.min(value.length(), MAX_CELL_CHARS);
      for (int i = 0; i < length; i++) {
        char ch = value.charAt(i);
        switch (ch) {
          case '&' -> out.append("&amp;");
          case '<' -> out.append("&lt;");
          case '>' -> out.append("&gt;");
          case '"' -> out.append("&quot;");
          default -> {
            boolean control = ch < 0x20 && ch != '\t' && ch != '\n' && ch != '\r';
            if (!control && ch != 0xFFFE && ch != 0xFFFF) out.append(ch);
          }
        }
      }
    }

    private static String columnName(int index) {
      StringBuilder name = new StringBuilder();
      for (int n = index; n >= 0; n = n / 26 - 1) name.insert(0, (char) ('A' + n % 26));
      return name.toString();
    }

    @Override
    public void close() throws IOException {
      if (sheetCount == 0) startSheet();
      endSheet();
      // Content types and workbook parts last: the sheet count is only known now.
      StringBuilder types = new StringBuilder();
      types.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>")
          .append("<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">")
          .append("<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>")
          .append("<Default Extension=\"xml\" ContentType=\"application/xml\"/>")
          .append("<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>")
          .append("<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>");
      StringBuilder workbook = new StringBuilder();
      workbook.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>")
          .append("<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" ")
          .append("xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets>");
      StringBuilder rels = new StringBuilder();
      rels.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>")
          .append("<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">");
      for (int i = 1; i <= sheetCount; i++) {
        types.append("<Override PartName=\"/xl/worksheets/sheet").append(i)
            .append(".xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>");
        workbook.append("<sheet name=\"").append(sheetNames.get(i - 1)).append("\" sheetId=\"").append(i)
            .append("\" r:id=\"rId").append(i).append("\"/>");
        rels.append("<Relationship Id=\"rId").append(i)
            .append("\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet")
            .append(i).append(".xml\"/>");
      }
      rels.append("<Relationship Id=\"rId").append(sheetCount + 1)
          .append("\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/></Relationships>");
      types.append("</Types>");
      workbook.append("</sheets></workbook>");
      putEntry("[Content_Types].xml", types.toString());
      putEntry(
          "_rels/.rels",
          "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
              + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
              + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>"
              + "</Relationships>");
      putEntry("xl/workbook.xml", workbook.toString());
      putEntry("xl/_rels/workbook.xml.rels", rels.toString());
      zip.close();
    }

    private void putEntry(String name, String content) throws IOException {
      zip.putNextEntry(new ZipEntry(name));
      zip.write(content.getBytes(StandardCharsets.UTF_8));
      zip.closeEntry();
    }
  }
}
