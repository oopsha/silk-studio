# MyBatis 동적 SQL 실행

설정의 MyBatis 파라미터 입력을 활성화하면 SQL 편집기의 Ctrl+Enter 및 스크립트 실행에서 동적 SQL을 처리합니다.
조건 변수와 SQL 파라미터는 한 창에서 입력하고 이름이 같은 항목은 한 번만 입력합니다.

지원: `if`, `choose/when/otherwise`, `where`, `trim`, `set`, `bind`, 선택적인 `script` 래퍼.
`foreach`와 외부 SQL을 참조하는 `include`는 현재 지원하지 않습니다.

```xml
SELECT * FROM CAA010MS
<where>
  <if test='pmsNo != null and pmsNo.toString() neq ""'>
    AND RSV_NO = pkg_udf.rsv_no_in(#{bizCode}, #{pmsNo})
  </if>
</where>
```

`pmsNo`가 빈 문자열/NULL이면 조건과 해당 바인딩이 모두 빠집니다.
문자열과 빈 문자열을 기본으로 사용합니다. 논리값은 `true`/`false`, 객체는 JSON으로 입력합니다.
`person.name` 같은 속성은 `person` 입력에 JSON 객체를 지정합니다. 숫자로 보이는 일반 입력은 앞자리 0을 보존하는 문자열입니다.

`#{value}`는 JDBC 바인딩, `${value}`는 SQL 텍스트 직접 치환입니다. `:name`/`?`도 해당 설정을 활성화하면 함께 사용 가능합니다.
일반 SQL의 `<`, `>`, `&`는 자동으로 보호합니다. XML 속성 안에서는 `&lt;` 등 XML 이스케이프를 사용합니다.
매퍼 파일 전체보다 실행할 SQL 본문을 붙여넣으세요.

Java의 MyBatis XMLLanguageDriver로 SQL을 준비한 뒤 기존 JDBC 실행 경로를 사용합니다.
SqlSession을 만들지 않으므로 자동 커밋과 트랜잭션은 기존 설정을 따릅니다.
