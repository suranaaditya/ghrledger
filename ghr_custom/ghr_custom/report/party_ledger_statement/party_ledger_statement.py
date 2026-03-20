import re
import frappe
from frappe import _
from frappe.utils import flt, cstr, escape_html, formatdate


def execute(filters=None):
	filters = frappe._dict(filters or {})
	validate_filters(filters)

	columns = get_columns(filters)
	message = get_report_header_html(filters)

	opening = get_opening_balance(filters)
	entries = get_gl_entries(filters)

	data = build_report_rows(filters, opening, entries)

	return columns, data, message


def build_report_rows(filters, opening, entries):
	data = []
	running_balance = opening
	show_remarks = cint_like(filters.get("show_narration"))

	if cint_like(filters.get("include_opening")):
		data.append(
			{
				"posting_date": "",
				"particulars": build_special_row_html("Opening Balance", "opening"),
				"particulars_plain": "Opening Balance",
				"voucher_subtype": "",
				"voucher_type_link": "",
				"voucher_no": "",
				"remarks": "",
				"debit": opening if opening > 0 else 0,
				"credit": abs(opening) if opening < 0 else 0,
				"balance": format_balance_number(running_balance),
				"row_kind": "opening",
				"narration_only": "",
			}
		)

	total_debit = 0.0
	total_credit = 0.0

	for gle in entries:
		debit = flt(gle.get("debit"))
		credit = flt(gle.get("credit"))

		total_debit += debit
		total_credit += credit
		running_balance += debit - credit

		narration = get_clean_narration(gle.get("remarks")) if show_remarks else ""

		data.append(
			{
				"posting_date": gle.get("posting_date"),
				"particulars": build_main_particular_html(filters, gle),
				"particulars_plain": get_main_particular_line(filters, gle),
				"voucher_subtype": get_voucher_subtype(gle),
				"voucher_type_link": gle.get("voucher_type"),
				"voucher_no": gle.get("voucher_no"),
				"remarks": narration,
				"debit": debit,
				"credit": credit,
				"balance": format_balance_number(running_balance),
				"row_kind": "normal",
				"narration_only": narration,
			}
		)

	data.append(
		{
			"posting_date": "",
			"particulars": build_special_row_html("Total", "total"),
			"particulars_plain": "Total",
			"voucher_subtype": "",
			"voucher_type_link": "",
			"voucher_no": "",
			"remarks": "",
			"debit": total_debit,
			"credit": total_credit,
			"balance": "",
			"row_kind": "total",
			"narration_only": "",
		}
	)

	data.append(
		{
			"posting_date": "",
			"particulars": build_special_row_html("Closing Balance", "closing"),
			"particulars_plain": "Closing Balance",
			"voucher_subtype": "",
			"voucher_type_link": "",
			"voucher_no": "",
			"remarks": "",
			"debit": running_balance if running_balance > 0 else 0,
			"credit": abs(running_balance) if running_balance < 0 else 0,
			"balance": format_balance_number(running_balance),
			"row_kind": "closing",
			"narration_only": "",
		}
	)

	return data


def validate_filters(filters):
	if not filters.get("company"):
		frappe.throw(_("Company is required"))

	if not filters.get("from_date"):
		frappe.throw(_("From Date is required"))

	if not filters.get("to_date"):
		frappe.throw(_("To Date is required"))

	if filters.get("from_date") > filters.get("to_date"):
		frappe.throw(_("From Date cannot be greater than To Date"))

	has_party = bool(filters.get("party"))
	has_account = bool(filters.get("account"))

	if not has_party and not has_account:
		frappe.throw(_("Please select either one Party or one Account"))

	if has_party and has_account:
		frappe.throw(_("Please select only one filter: either Party or Account, not both"))

	if has_party and not filters.get("party_type"):
		frappe.throw(_("Party Type is required when Party is selected"))


def get_columns(filters):
	show_remarks = cint_like(filters.get("show_narration"))

	columns = [
		{
			"label": _("Date"),
			"fieldname": "posting_date",
			"fieldtype": "Date",
			"width": 95,
		},
		{
			"label": _("Particulars"),
			"fieldname": "particulars",
			"fieldtype": "HTML",
			"width": 310,
		},
		{
			"label": _("Voucher Subtype"),
			"fieldname": "voucher_subtype",
			"fieldtype": "Data",
			"width": 150,
		},
		{
			"label": _("Voucher No"),
			"fieldname": "voucher_no",
			"fieldtype": "Dynamic Link",
			"options": "voucher_type_link",
			"width": 185,
		},
		{
			"label": _("Debit"),
			"fieldname": "debit",
			"fieldtype": "Currency",
			"width": 130,
		},
		{
			"label": _("Credit"),
			"fieldname": "credit",
			"fieldtype": "Currency",
			"width": 130,
		},
		{
			"label": _("Balance"),
			"fieldname": "balance",
			"fieldtype": "Data",
			"width": 145,
		},
	]

	if show_remarks:
		columns.append(
			{
				"label": _("Remarks"),
				"fieldname": "remarks",
				"fieldtype": "HTML",
				"width": 320,
			}
		)

	return columns


def get_report_header_html(filters):
	ledger_name = filters.get("party") or filters.get("account") or ""
	ledger_type = filters.get("party_type") if filters.get("party") else "Account Ledger"

	return f"""
		<div class="party-ledger-header">
			<div class="party-ledger-header__company">{escape_html(cstr(filters.get("company")))}</div>
			<div class="party-ledger-header__title">Party Ledger Statement</div>
			<div class="party-ledger-header__meta">
				<div><strong>Ledger:</strong> {escape_html(cstr(ledger_name))}</div>
				<div><strong>Type:</strong> {escape_html(cstr(ledger_type))}</div>
				<div><strong>Period:</strong> {escape_html(formatdate(filters.get("from_date")))} to {escape_html(formatdate(filters.get("to_date")))}</div>
			</div>
		</div>
	"""


def get_opening_balance(filters):
	conditions = get_conditions(filters, before_from_date=True)

	result = frappe.db.sql(
		f"""
		select
			sum(debit) as debit,
			sum(credit) as credit
		from `tabGL Entry`
		where docstatus < 2
			and ifnull(is_cancelled, 0) = 0
			{conditions}
		""",
		filters,
		as_dict=True,
	)

	debit = flt(result[0].get("debit")) if result else 0
	credit = flt(result[0].get("credit")) if result else 0
	return debit - credit


def get_gl_entries(filters):
	conditions = get_conditions(filters, before_from_date=False)

	return frappe.db.sql(
		f"""
		select
			name,
			posting_date,
			voucher_type,
			voucher_no,
			account,
			party_type,
			party,
			against,
			remarks,
			debit,
			credit,
			cost_center,
			project,
			is_cancelled
		from `tabGL Entry`
		where docstatus < 2
			and ifnull(is_cancelled, 0) = 0
			{conditions}
		order by posting_date, creation, name
		""",
		filters,
		as_dict=True,
	)


def get_conditions(filters, before_from_date=False):
	conditions = ["and company = %(company)s"]

	if before_from_date:
		conditions.append("and posting_date < %(from_date)s")
	else:
		conditions.append("and posting_date between %(from_date)s and %(to_date)s")

	if filters.get("party"):
		conditions.append("and party_type = %(party_type)s")
		conditions.append("and party = %(party)s")

	if filters.get("account"):
		conditions.append("and account = %(account)s")

	if filters.get("cost_center"):
		conditions.append("and cost_center = %(cost_center)s")

	if filters.get("project"):
		conditions.append("and project = %(project)s")

	return "\n".join(conditions)


def build_main_particular_html(filters, gle):
	main_line = escape_html(get_main_particular_line(filters, gle))
	return f"<div class='pls-main'>{main_line}</div>"


def build_special_row_html(label, row_type):
	css_map = {
		"opening": "pls-special pls-opening",
		"total": "pls-special pls-total",
		"closing": "pls-special pls-closing",
	}
	css_class = css_map.get(row_type, "pls-special")
	return f"<div class='{css_class}'>{escape_html(label)}</div>"


def get_main_particular_line(filters, gle):
	if filters.get("party"):
		counter_name = get_against_label(gle)
		prefix = "To" if flt(gle.get("debit")) > 0 else "By"
		return f"{prefix} {counter_name}"

	if filters.get("account"):
		counter_name = get_party_or_against_label(gle)
		prefix = "To" if flt(gle.get("debit")) > 0 else "By"
		return f"{prefix} {counter_name}"

	return get_against_label(gle)


def get_against_label(gle):
	against = cstr(gle.get("against")).strip()
	if against:
		return against

	account = cstr(gle.get("account")).strip()
	if account:
		return account

	return "-"


def get_party_or_against_label(gle):
	party = cstr(gle.get("party")).strip()
	if party:
		return party

	against = cstr(gle.get("against")).strip()
	if against:
		return against

	account = cstr(gle.get("account")).strip()
	if account:
		return account

	return "-"


def get_voucher_subtype(gle):
	voucher_type = cstr(gle.get("voucher_type"))
	voucher_no = cstr(gle.get("voucher_no"))

	if not voucher_type or not voucher_no:
		return voucher_type

	try:
		if voucher_type == "Payment Entry":
			payment_type = frappe.get_cached_value("Payment Entry", voucher_no, "payment_type")
			return payment_type or voucher_type

		if voucher_type == "Journal Entry":
			je_type = frappe.get_cached_value("Journal Entry", voucher_no, "voucher_type")
			return je_type or voucher_type

		if voucher_type == "Purchase Invoice":
			is_return = frappe.get_cached_value("Purchase Invoice", voucher_no, "is_return")
			return "Debit Note" if is_return else "Purchase Invoice"

		if voucher_type == "Sales Invoice":
			is_return = frappe.get_cached_value("Sales Invoice", voucher_no, "is_return")
			return "Credit Note" if is_return else "Sales Invoice"

	except Exception:
		pass

	return voucher_type


def get_clean_narration(raw_remarks):
	narration = cstr(raw_remarks).strip()
	if not narration:
		return ""

	normalized = re.sub(r"[\s\.\-_]+", " ", narration).strip().lower()

	if normalized in {"no remarks", "no remark", "remarks", "remark", "n a", "na", "nil", "-"}:
		return ""

	return narration


def format_balance_number(amount):
	amount = flt(amount)
	if not amount:
		return "0.00"
	return f"{amount:,.2f}"


def cint_like(value):
	return 1 if str(value) in ("1", "true", "True") else 0


def format_print_date_ddyymmdd(date_value):
	if not date_value:
		return ""
	return formatdate(date_value, "dd-mm-yy")


@frappe.whitelist()
def get_print_data(filters=None):
	if isinstance(filters, str):
		filters = frappe.parse_json(filters)

	filters = frappe._dict(filters or {})
	validate_filters(filters)

	opening = get_opening_balance(filters)
	entries = get_gl_entries(filters)
	data = build_report_rows(filters, opening, entries)

	print_rows = []
	for row in data:
		row = frappe._dict(row)

		print_rows.append(
			{
				**row,
				"posting_date": format_print_date_ddyymmdd(row.get("posting_date")),
			}
		)

		narration = row.get("narration_only") or row.get("remarks") or ""
		if row.get("row_kind") == "normal" and narration:
			print_rows.append(
				{
					"posting_date": "",
					"particulars": "",
					"particulars_plain": "",
					"voucher_subtype": "",
					"voucher_type_link": "",
					"voucher_no": "",
					"remarks": "",
					"debit": "",
					"credit": "",
					"balance": "",
					"row_kind": "narration",
					"narration_only": narration,
				}
			)

	return {
		"company": filters.get("company"),
		"from_date": format_print_date_ddyymmdd(filters.get("from_date")),
		"to_date": format_print_date_ddyymmdd(filters.get("to_date")),
		"party_type": filters.get("party_type") or "",
		"ledger_name": filters.get("party") or filters.get("account") or "",
		"rows": print_rows,
	}


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def get_party_query(doctype, txt, searchfield, start, page_len, filters):
	filters = frappe._dict(filters or {})

	party_type = filters.get("party_type")
	company = filters.get("company")

	if not party_type or not company:
		return []

	return frappe.db.sql(
		"""
		select distinct gle.party
		from `tabGL Entry` gle
		where gle.party_type = %(party_type)s
			and gle.company = %(company)s
			and ifnull(gle.party, '') != ''
			and ifnull(gle.is_cancelled, 0) = 0
			and gle.docstatus < 2
			and gle.party like %(txt)s
		order by gle.party
		limit %(start)s, %(page_len)s
		""",
		{
			"party_type": party_type,
			"company": company,
			"txt": f"%{txt}%",
			"start": start,
			"page_len": page_len,
		},
		as_list=True,
	)
