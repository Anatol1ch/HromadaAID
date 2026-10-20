#!/usr/bin/env python3
"""Idempotent import of the 2026 register sheet into an already-migrated HromadaAid SQLite DB.

Uses only Python's standard library. Makes a SQLite-consistent backup before writing.
The review CSV contains source row numbers and issue codes only, no personal data.
"""
import argparse
import csv
import hashlib
import json
import os
import re
import shutil
import sqlite3
import sys
import unicodedata
import uuid
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from datetime import datetime

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

NS = {
    'm': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'p': 'http://schemas.openxmlformats.org/package/2006/relationships',
}
PROGRAMS = {
    'програма соціального захисту': 'program-social',
    'програма підтримки ветеранів': 'program-veterans',
}
TYPES = {
    'на лікування хворим, онкохворим': ('aid-social-treatment', 'program-social'),
    'ліквідаторам чаес': ('aid-social-chernobyl', 'program-social'),
    'на лікування поранень внаслідок атаки': ('aid-social-attack-injury', 'program-social'),
    'одноразова на поховання (загиблим)': ('aid-veterans-funeral-killed', 'program-veterans'),
    'одноразова на поховання (померлим)': ('aid-veterans-funeral-deceased', 'program-veterans'),
    'щорічна військовослужбовцям': ('aid-veterans-annual-service', 'program-veterans'),
    'одноразова на лікування поранень': ('aid-veterans-wounds', 'program-veterans'),
    "щорічна сім'ям загиблих(померлих)": ('aid-veterans-families', 'program-veterans'),
    "щорічна сім'ям безвісти зниклих": ('aid-veterans-missing-family', 'program-veterans'),
}


def norm(text):
    return ' '.join(unicodedata.normalize('NFKC', str(text or '')).split()).casefold()


def xlsx_sheet_rows(path, wanted, include_formulas=False):
    with zipfile.ZipFile(path) as book:
        shared = []
        if 'xl/sharedStrings.xml' in book.namelist():
            root = ET.fromstring(book.read('xl/sharedStrings.xml'))
            shared = [''.join(n.text or '' for n in item.findall('.//m:t', NS)) for item in root.findall('m:si', NS)]
        wb = ET.fromstring(book.read('xl/workbook.xml'))
        rels = ET.fromstring(book.read('xl/_rels/workbook.xml.rels'))
        relmap = {r.attrib['Id']: r.attrib['Target'] for r in rels.findall('p:Relationship', NS)}
        target = None
        for sheet in wb.findall('m:sheets/m:sheet', NS):
            if sheet.attrib.get('name') == wanted:
                target = relmap[sheet.attrib[f'{{{NS["r"]}}}id']]
                break
        if not target:
            raise ValueError(f'Не знайдено аркуш {wanted}.')
        xml_path = target.lstrip('/') if target.startswith('/') else 'xl/' + target
        xml_path = os.path.normpath(xml_path).replace('\\', '/')
        root = ET.fromstring(book.read(xml_path))
        rows = []
        for row in root.findall('.//m:sheetData/m:row', NS):
            values = {}
            formulas = {}
            for cell in row.findall('m:c', NS):
                ref = cell.attrib.get('r', '')
                match = re.match(r'([A-Z]+)', ref)
                if not match:
                    continue
                col = 0
                for char in match.group(1):
                    col = col * 26 + ord(char) - 64
                col -= 1
                value_node = cell.find('m:v', NS)
                formula_node = cell.find('m:f', NS)
                if formula_node is not None and formula_node.text:
                    formulas[col] = '=' + formula_node.text
                if cell.attrib.get('t') == 'inlineStr':
                    value = ''.join(n.text or '' for n in cell.findall('.//m:t', NS))
                elif value_node is None:
                    value = None
                else:
                    value = value_node.text
                    if cell.attrib.get('t') == 's' and value is not None:
                        value = shared[int(value)]
                    elif cell.attrib.get('t') not in ('str', 's', 'b', 'e'):
                        try:
                            value = float(value)
                            if value.is_integer():
                                value = int(value)
                        except ValueError:
                            pass
                values[col] = value
            rows.append((int(row.attrib['r']), values, formulas) if include_formulas else (int(row.attrib['r']), values))
        return rows


def decision_parts(value):
    match = re.search(r'№\s*(.*?)\s+від\s+(\d{1,2})\.(\d{1,2})\.(\d{4})', str(value or ''), re.I)
    if not match:
        return None
    number = match.group(1).strip()
    date = f'{int(match.group(4)):04d}-{int(match.group(3)):02d}-{int(match.group(2)):02d}'
    try:
        datetime.strptime(date, '%Y-%m-%d')
    except ValueError:
        return None
    return number, date


def amount_minor(value):
    try:
        raw = str(value).strip().replace(' ', '').replace(',', '.')
        amount = float(raw)
        minor = round(amount * 100)
        if amount <= 0 or abs(amount * 100 - minor) > 0.001:
            return None
        return minor
    except (TypeError, ValueError):
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--database', required=True, help='Повний шлях до hromada-aid.sqlite')
    parser.add_argument('--workbook', required=True, help='Шлях до незміненої книги Реєстр.xlsx')
    args = parser.parse_args()
    db_path = os.path.abspath(args.database)
    workbook = os.path.abspath(args.workbook)
    if not os.path.isfile(db_path) or not os.path.isfile(workbook):
        raise SystemExit('Не знайдено файл бази або книги.')
    source_hash = hashlib.sha256(open(workbook, 'rb').read()).hexdigest()
    sheet_rows = xlsx_sheet_rows(workbook, 'РЕЄСТР')
    header_row = next((values for number, values in sheet_rows if number == 4), None)
    if not header_row or norm(header_row.get(1)) != 'рішення' or norm(header_row.get(8)) != 'розмір допомоги':
        raise SystemExit('Заголовки аркуша не збігаються з очікуваною структурою. Імпорт зупинено.')

    records = []
    for row_number, cells in sheet_rows:
        if row_number < 5 or not (cells.get(4) or cells.get(5)):
            continue
        full_name = ' '.join(str(cells.get(i) or '').strip() for i in (4, 5, 6)).strip()
        parts = decision_parts(cells.get(1))
        program_key = norm(cells.get(2))
        type_key = norm(cells.get(3))
        amount = amount_minor(cells.get(8))
        person_name = [str(cells.get(i) or '').strip() for i in (4, 5, 6)]
        sex_raw = norm(cells.get(7))
        sex = 'Жінка' if sex_raw == 'жінка' else 'Чоловік' if sex_raw == 'чоловік' else None
        vpo_raw = norm(cells.get(9))
        is_vpo = 1 if vpo_raw == 'впо' else None if not vpo_raw else None
        issues = []
        review_issues = ['vpo_not_specified'] if not vpo_raw else []
        if type_key == 'ліквідаторам чаес':
            review_issues.append('program_mapping_conflict_BASE_vs_REGISTER')
        if not all(person_name[:2]) or not full_name:
            issues.append('missing_name')
        if not parts:
            issues.append('invalid_decision')
        if program_key not in PROGRAMS:
            issues.append('unknown_program')
        if type_key not in TYPES:
            issues.append('unknown_aid_type')
        if amount is None:
            issues.append('invalid_amount')
        if vpo_raw and vpo_raw != 'впо':
            issues.append('unknown_vpo_marker')
        if issues:
            records.append({'row': row_number, 'issues': issues})
            continue
        aid_id, expected_program = TYPES[type_key]
        if PROGRAMS[program_key] != expected_program:
            issues.append('program_aid_type_conflict')
        if issues:
            records.append({'row': row_number, 'issues': issues})
            continue
        records.append({'row': row_number, 'name': person_name, 'full_name': full_name, 'name_key': norm(full_name),
                        'decision': parts, 'program_id': PROGRAMS[program_key], 'aid_id': aid_id,
                        'amount': amount, 'sex': sex, 'is_vpo': is_vpo, 'issues': [], 'review_issues': review_issues})

    valid = [r for r in records if not r['issues']]
    if not valid or any(r['issues'] for r in records):
        for item in records:
            if item['issues']:
                print('SOURCE_ROW_REQUIRES_REVIEW', item['row'], ','.join(item['issues']))
        raise SystemExit('Є некоректні рядки. До виправлення жодного рядка не імпортовано.')
    occurrences = Counter(r['name_key'] for r in valid)
    for item in valid:
        if occurrences[item['name_key']] > 1:
            item['review_issues'].append('duplicate_name_no_identity_identifier')

    db = sqlite3.connect(db_path, timeout=30)
    db.execute('PRAGMA foreign_keys=ON')
    db.execute('PRAGMA busy_timeout=30000')
    version = db.execute('PRAGMA user_version').fetchone()[0]
    if version < 5:
        db.close()
        raise SystemExit('Спершу запустіть застосунок, щоб він застосував адитивні міграції до версії 4.')
    table = db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='imported_source_rows'").fetchone()
    if not table:
        db.close()
        raise SystemExit('Відсутня таблиця походження імпортованих рядків.')
    existing_names = defaultdict(list)
    for row in db.execute('''SELECT r.id,r.last_name,r.first_name,r.patronymic FROM recipients r
      WHERE NOT EXISTS (SELECT 1 FROM assignments a JOIN imported_source_rows s ON s.assignment_id=a.id
                        WHERE a.recipient_id=r.id)''').fetchall():
        existing_names[norm(' '.join(str(x or '') for x in row[1:]))].append(row[0])
    for item in valid:
        if existing_names.get(item['name_key']):
            item['review_issues'].append('same_name_in_existing_database_not_merged')

    pending = [item for item in valid if not db.execute(
        'SELECT 1 FROM imported_source_rows WHERE source_hash=? AND worksheet=? AND source_row_number=?',
        (source_hash, 'РЕЄСТР', item['row'])).fetchone()]
    review_pending = []
    for item in valid:
        source_row = db.execute('SELECT id FROM imported_source_rows WHERE source_hash=? AND worksheet=? AND source_row_number=?',
                                (source_hash, 'РЕЄСТР', item['row'])).fetchone()
        if source_row:
            old_reasons = {r[0] for r in db.execute('SELECT reason FROM import_review_items WHERE import_source_row_id=?', (source_row[0],)).fetchall()}
            for reason in item['review_issues']:
                if reason not in old_reasons:
                    review_pending.append((source_row[0], reason))
    report_sheets = ('ПЛАН', 'ФАКТ (МІСЯЦЬ)', 'ФАКТ (КВАРТАЛ)', 'ПЛАН-ФАКТ (РІК)')
    report_pending = []
    for sheet_name in report_sheets:
        source_rows = xlsx_sheet_rows(workbook, sheet_name, include_formulas=True)
        as_of = ''
        if sheet_name == 'ПЛАН-ФАКТ (РІК)':
            as_of = str(next((v.get(1) for n, v, _ in source_rows if n == 4), '') or '')
        for row_number, values, formulas in source_rows:
            if row_number < 4 or row_number > 19 or (row_number >= 8 and not values.get(1)) or (row_number < 8 and not any(values.values())):
                continue
            if db.execute('SELECT 1 FROM reporting_source_rows WHERE source_hash=? AND worksheet=? AND source_row_number=?',
                          (source_hash, sheet_name, row_number)).fetchone():
                continue
            end_col = max(values.keys(), default=1)
            data_values = [values.get(index) for index in range(2, end_col + 1)]
            formula_values = [formulas.get(index) for index in range(2, end_col + 1)]
            report_pending.append((sheet_name, row_number, str(values[1]), json.dumps(data_values, ensure_ascii=False),
                                   json.dumps(formula_values, ensure_ascii=False), as_of))
    backup_path = None
    if pending or report_pending or review_pending:
        stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
        backup_path = db_path + '.before-import-' + stamp + '.sqlite'
        backup = sqlite3.connect(backup_path)
        db.backup(backup)
        backup.close()
        try:
            db.execute('BEGIN IMMEDIATE')
            recipient_by_name = {}
            for item in pending:
                key = item['name_key']
                if occurrences[key] == 1 and key in recipient_by_name:
                    recipient_id = recipient_by_name[key]
                else:
                    recipient_id = str(uuid.uuid4())
                    db.execute('''INSERT INTO recipients(id,last_name,first_name,patronymic,sex,is_demo,created_at,updated_at,is_vpo)
                      VALUES(?,?,?,?,?,0,?,?,?)''',
                      (recipient_id, item['name'][0], item['name'][1], item['name'][2] or None, item['sex'], datetime.now().isoformat(timespec='seconds'), datetime.now().isoformat(timespec='seconds'), item['is_vpo']))
                    if occurrences[key] == 1:
                        recipient_by_name[key] = recipient_id
                number, decision_date = item['decision']
                decision_id = db.execute('SELECT id FROM decisions WHERE decision_number=? AND decision_date=?', (number, decision_date)).fetchone()
                if decision_id:
                    decision_id = decision_id[0]
                else:
                    decision_id = str(uuid.uuid4())
                    now = datetime.now().isoformat(timespec='seconds')
                    db.execute('INSERT INTO decisions(id,decision_number,decision_date,created_at,updated_at) VALUES(?,?,?,?,?)',
                               (decision_id, number, decision_date, now, now))
                catalog = db.execute('SELECT id,program_id,direction,funding_source FROM aid_types WHERE id=? AND is_active=1', (item['aid_id'],)).fetchone()
                if not catalog or catalog[1] != item['program_id']:
                    raise RuntimeError('Каталог програми/допомоги не відповідає мапінгу; транзакцію скасовано.')
                assignment_id = str(uuid.uuid4())
                now = datetime.now().isoformat(timespec='seconds')
                db.execute('''INSERT INTO assignments(id,recipient_id,decision_id,aid_type_id,amount_minor,status,direction,funding_source,created_at,updated_at)
                  VALUES(?,?,?,?,?,'Призначено',?,?,?,?)''',
                  (assignment_id, recipient_id, decision_id, item['aid_id'], item['amount'], catalog[2], catalog[3], now, now))
                source_id = str(uuid.uuid4())
                db.execute('INSERT INTO imported_source_rows(id,source_hash,worksheet,source_row_number,assignment_id,imported_at) VALUES(?,?,?,?,?,?)',
                           (source_id, source_hash, 'РЕЄСТР', item['row'], assignment_id, now))
            for sheet_name, row_number, label, data_json, formulas_json, as_of in report_pending:
                db.execute('INSERT INTO reporting_source_rows(id,source_hash,worksheet,source_row_number,item_label,data_json,formulas_json,report_as_of) VALUES(?,?,?,?,?,?,?,?)',
                           (str(uuid.uuid4()), source_hash, sheet_name, row_number, label, data_json, formulas_json, as_of))
            for item in valid:
                source_row = db.execute('SELECT id FROM imported_source_rows WHERE source_hash=? AND worksheet=? AND source_row_number=?',
                                        (source_hash, 'РЕЄСТР', item['row'])).fetchone()
                if not source_row:
                    raise RuntimeError('Не знайдено походження імпортованого рядка.')
                old_reasons = {r[0] for r in db.execute('SELECT reason FROM import_review_items WHERE import_source_row_id=?', (source_row[0],)).fetchall()}
                for reason in item['review_issues']:
                    if reason not in old_reasons:
                        db.execute('INSERT INTO import_review_items(id,import_source_row_id,reason) VALUES(?,?,?)',
                                   (str(uuid.uuid4()), source_row[0], reason))
            db.commit()
        except Exception:
            db.rollback()
            raise

    imported = db.execute('''SELECT COUNT(*),COALESCE(SUM(a.amount_minor),0),COALESCE(SUM(a.status='Виплачено'),0)
      FROM imported_source_rows s JOIN assignments a ON a.id=s.assignment_id WHERE s.source_hash=? AND s.worksheet='РЕЄСТР' ''',
      (source_hash,)).fetchone()
    expected_count = len(valid)
    expected_total = sum(item['amount'] for item in valid)
    if imported[0] != expected_count or imported[1] != expected_total:
        db.close()
        raise SystemExit(f'Звірка не пройшла: джерело {expected_count}/{expected_total}, БД {imported[0]}/{imported[1]}.')

    report_path = os.path.join(os.path.dirname(db_path), 'hromada-aid-import-review-2026.csv')
    reviews = db.execute('''SELECT s.source_row_number, r.reason FROM import_review_items r
      JOIN imported_source_rows s ON s.id=r.import_source_row_id
      WHERE s.source_hash=? AND s.worksheet='РЕЄСТР' AND r.resolved_at IS NULL
      ORDER BY s.source_row_number,r.reason''', (source_hash,)).fetchall()
    with open(report_path, 'w', encoding='utf-8-sig', newline='') as output:
        writer = csv.writer(output)
        writer.writerow(['Рядок джерела', 'Причина перевірки'])
        writer.writerows(reviews)
    print('SOURCE_ROWS', expected_count)
    print('SOURCE_TOTAL_MINOR', expected_total)
    print('IMPORTED_ROWS', imported[0])
    print('IMPORTED_TOTAL_MINOR', imported[1])
    print('PAID_ROWS_CREATED', 0)
    print('REVIEW_ROWS', len({row[0] for row in reviews}))
    report_imported = db.execute('SELECT COUNT(*) FROM reporting_source_rows WHERE source_hash=?', (source_hash,)).fetchone()[0]
    print('REPORT_SOURCE_ROWS', report_imported)
    print('REVIEW_REPORT', report_path)
    print('BACKUP', backup_path if backup_path else 'не потрібна: джерело вже імпортоване')
    print('REPEAT_SAFE', 'так; хеш книги, аркуш і номер рядка')
    db.close()


if __name__ == '__main__':
    main()
