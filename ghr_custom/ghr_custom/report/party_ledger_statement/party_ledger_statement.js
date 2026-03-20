frappe.query_reports["Party Ledger Statement"] = {
	filters: [
		{
			fieldname: "company",
			label: __("Company"),
			fieldtype: "Link",
			options: "Company",
			reqd: 1,
			default: frappe.defaults.get_user_default("Company"),
		},
		{
			fieldname: "from_date",
			label: __("From Date"),
			fieldtype: "Date",
			reqd: 1,
			default: frappe.datetime.month_start(),
		},
		{
			fieldname: "to_date",
			label: __("To Date"),
			fieldtype: "Date",
			reqd: 1,
			default: frappe.datetime.month_end(),
		},
		{
			fieldname: "party_type",
			label: __("Party Type"),
			fieldtype: "Link",
			options: "Party Type",
			on_change: function (report) {
				const party_type = report.get_filter_value("party_type");
				const party_filter = report.get_filter("party");

				report.set_filter_value("party", "");

				if (party_type) {
					party_filter.df.options = party_type;
				} else {
					party_filter.df.options = "";
				}

				party_filter.refresh();
			},
		},
		{
			fieldname: "party",
			label: __("Party"),
			fieldtype: "Link",
			options: "",
			get_query: function () {
				const party_type = frappe.query_report.get_filter_value("party_type");
				const company = frappe.query_report.get_filter_value("company");

				if (!party_type || !company) {
					return {};
				}

				return {
					query: "ghr_custom.ghr_custom.report.party_ledger_statement.party_ledger_statement.get_party_query",
					filters: {
						party_type: party_type,
						company: company,
					},
				};
			},
		},
		{
			fieldname: "account",
			label: __("Account"),
			fieldtype: "Link",
			options: "Account",
			get_query: function () {
				const company = frappe.query_report.get_filter_value("company");
				let filters = { is_group: 0 };

				if (company) {
					filters.company = company;
				}

				return { filters: filters };
			},
		},
		{
			fieldname: "cost_center",
			label: __("Cost Center"),
			fieldtype: "Link",
			options: "Cost Center",
			get_query: function () {
				const company = frappe.query_report.get_filter_value("company");
				let filters = {};

				if (company) {
					filters.company = company;
				}

				return { filters: filters };
			},
		},
		{
			fieldname: "project",
			label: __("Project"),
			fieldtype: "Link",
			options: "Project",
		},
		{
			fieldname: "include_opening",
			label: __("Include Opening"),
			fieldtype: "Check",
			default: 1,
		},
		{
			fieldname: "show_narration",
			label: __("Show Remarks"),
			fieldtype: "Check",
			default: 1,
			on_change: function (report) {
				report.refresh();
			},
		},
	],

	get_datatable_options(options) {
		return Object.assign(options, {
			serialNoColumn: false,
			checkboxColumn: false,
			inlineFilters: false,
			dynamicRowHeight: true,
			cellHeight: 42,
		});
	},

	onload: function (report) {
		inject_party_ledger_styles();

		const party_type = report.get_filter_value("party_type");
		const party_filter = report.get_filter("party");

		if (party_type) {
			party_filter.df.options = party_type;
			party_filter.refresh();
		}

		report.page.add_inner_button(__("Validate Filters"), function () {
			validate_party_or_account(report);
		});

		report.page.add_inner_button(__("Print Ledger"), function () {
			print_party_ledger(report);
		});
	},

	before_refresh: function () {
		validate_party_or_account(frappe.query_report, false);
	},

	formatter: function (value, row, column, data, default_formatter) {
		let formatted_value = default_formatter(value, row, column, data);

		if (!data) return formatted_value;

		const row_kind = data.row_kind || "normal";

		if (column.fieldname === "particulars") {
			return data.particulars || "";
		}

		if (column.fieldname === "remarks") {
			if (!data.remarks) return "";
			return `<div class="pls-remarks">${frappe.utils.escape_html(data.remarks)}</div>`;
		}

		if (column.fieldname === "voucher_subtype" && value) {
			return `<div class="pls-subtype">${frappe.utils.escape_html(value)}</div>`;
		}

		if (column.fieldname === "balance") {
			let cls = "pls-balance";
			if (row_kind === "opening") cls += " pls-balance-opening";
			if (row_kind === "total") cls += " pls-balance-total";
			if (row_kind === "closing") cls += " pls-balance-closing";
			return `<div class="${cls}">${formatted_value}</div>`;
		}

		if (["debit", "credit"].includes(column.fieldname) && (row_kind === "total" || row_kind === "closing")) {
			return `<div class="pls-amount-strong">${formatted_value}</div>`;
		}

		return formatted_value;
	},
};

function validate_party_or_account(report, show_message = true) {
	const party = report.get_filter_value("party");
	const account = report.get_filter_value("account");

	if (!party && !account) {
		if (show_message) {
			frappe.msgprint(__("Please select either one Party or one Account."));
		}
		return false;
	}

	if (party && account) {
		if (show_message) {
			frappe.msgprint(__("Please select only one filter: either Party or Account, not both."));
		}
		return false;
	}

	return true;
}

function print_party_ledger(report) {
	const filters = report.get_values();

	if (!validate_party_or_account(report, true)) {
		return;
	}

	frappe.call({
		method: "ghr_custom.ghr_custom.report.party_ledger_statement.party_ledger_statement.get_print_data",
		args: {
			filters: filters,
		},
		callback: function (r) {
			if (!r.message) return;

			const printData = r.message;
			const html = build_party_ledger_print_html(printData);

			const printWindow = window.open("", "_blank");
			printWindow.document.open();
			printWindow.document.write(html);
			printWindow.document.close();

			setTimeout(() => {
				printWindow.focus();
				printWindow.print();
			}, 500);
		},
	});
}

function build_party_ledger_print_html(data) {
	const rowsHtml = build_print_rows_html(data.rows || []);

	return `
<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<title>Party Ledger Statement</title>
	<style>
		@page {
			size: A4 portrait;
			margin: 14mm 12mm 14mm 12mm;
		}

		body {
			font-family: Arial, Helvetica, sans-serif;
			color: #1f2937;
			margin: 0;
			padding: 0;
			background: #ffffff;
			font-size: 12px;
		}

		.print-wrap {
			width: 100%;
		}

		.header-card {
			border: 1px solid #d9e3f0;
			background: linear-gradient(135deg, #f8fbff 0%, #eef5ff 100%);
			border-radius: 14px;
			padding: 16px 18px;
			margin-bottom: 14px;
		}

		.company-name {
			font-size: 22px;
			font-weight: 700;
			color: #102a43;
			margin-bottom: 4px;
		}

		.report-title {
			font-size: 16px;
			font-weight: 700;
			color: #1f3b5b;
			margin-bottom: 10px;
		}

		.meta-grid {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 6px 18px;
			font-size: 12px;
			color: #44546a;
		}

		.meta-grid div strong {
			color: #243b53;
		}

		table {
			width: 100%;
			border-collapse: collapse;
			table-layout: fixed;
		}

		thead th {
			background: #eef2f7;
			color: #243b53;
			font-weight: 700;
			font-size: 12px;
			border: 1px solid #d8dee9;
			padding: 8px 8px;
			text-align: left;
		}

		tbody td {
			border: 1px solid #e5e7eb;
			padding: 7px 8px;
			vertical-align: top;
			font-size: 12px;
			word-wrap: break-word;
		}

		.text-right {
			text-align: right;
		}

		.part-main {
			font-weight: 600;
			color: #1f2937;
			line-height: 1.45;
		}

		.row-narration td {
			padding-top: 4px;
			padding-bottom: 7px;
			background: #ffffff;
		}

		.narration-span-cell {
			font-size: 11px;
			color: #6b7280;
			line-height: 1.45;
			font-style: italic;
			white-space: pre-wrap;
		}

		.row-opening td {
			background: #f8fbff;
		}

		.row-opening .part-main,
		.row-opening .balance-cell {
			font-weight: 700;
			color: #163b65;
		}

		.row-total td {
			background: #fff9f0;
			font-weight: 700;
		}

		.row-total .part-main,
		.row-total .balance-cell {
			color: #8a5200;
		}

		.row-closing td {
			background: #f3fbf6;
			font-weight: 700;
		}

		.row-closing .part-main,
		.row-closing .balance-cell {
			color: #0f5132;
		}

		.footer-note {
			margin-top: 10px;
			font-size: 10px;
			color: #6b7280;
			text-align: right;
		}
	</style>
</head>
<body>
	<div class="print-wrap">
		<div class="header-card">
			<div class="company-name">${escape_html_safe(data.company || "")}</div>
			<div class="report-title">Party Ledger Statement</div>
			<div class="meta-grid">
				<div><strong>Ledger:</strong> ${escape_html_safe(data.ledger_name || "")}</div>
				<div><strong>Type:</strong> ${escape_html_safe(data.party_type || "Account Ledger")}</div>
				<div><strong>From Date:</strong> ${escape_html_safe(data.from_date || "")}</div>
				<div><strong>To Date:</strong> ${escape_html_safe(data.to_date || "")}</div>
			</div>
		</div>

		<table>
			<thead>
				<tr>
					<th>Date</th>
					<th>Particulars</th>
					<th>Voucher Subtype</th>
					<th>Voucher No</th>
					<th class="text-right">Debit</th>
					<th class="text-right">Credit</th>
					<th class="text-right">Balance</th>
				</tr>
			</thead>
			<tbody>
				${rowsHtml}
			</tbody>
		</table>

		<div class="footer-note">Generated from ERPNext Party Ledger Statement</div>
	</div>
</body>
</html>
	`;
}

function build_print_rows_html(rows) {
	return rows
		.map((row) => {
			if ((row.row_kind || "normal") === "narration") {
				return `
					<tr class="row-narration">
						<td></td>
						<td colspan="3" class="narration-span-cell">${escape_html_safe(row.narration_only || "")}</td>
						<td></td>
						<td></td>
						<td></td>
					</tr>
				`;
			}

			const particulars = build_print_particulars(row);
			const rowClass = `row-${row.row_kind || "normal"}`;

			return `
				<tr class="${rowClass}">
					<td>${escape_html_safe(row.posting_date || "")}</td>
					<td>${particulars}</td>
					<td>${escape_html_safe(row.voucher_subtype || "")}</td>
					<td>${escape_html_safe(row.voucher_no || "")}</td>
					<td class="text-right">${format_print_amount(row.debit)}</td>
					<td class="text-right">${format_print_amount(row.credit)}</td>
					<td class="text-right balance-cell">${escape_html_safe(row.balance || "")}</td>
				</tr>
			`;
		})
		.join("");
}

function build_print_particulars(row) {
	const mainText = row.particulars_plain || "";
	return `<div class="part-main">${escape_html_safe(mainText)}</div>`;
}

function format_print_amount(value) {
	const num = flt(value);
	if (!num) return "";
	return format_currency(num, frappe.defaults.get_default("currency"));
}

function escape_html_safe(value) {
	if (value === null || value === undefined) return "";
	return String(value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function inject_party_ledger_styles() {
	if (document.getElementById("party-ledger-statement-styles")) return;

	const style = document.createElement("style");
	style.id = "party-ledger-statement-styles";
	style.innerHTML = `
		.pls-main {
			font-weight: 500;
			color: #1f2937;
			line-height: 1.45;
		}

		.pls-remarks {
			color: #6b7280;
			font-size: 11px;
			line-height: 1.5;
			font-style: italic;
			white-space: normal !important;
			word-break: break-word;
			overflow-wrap: anywhere;
			display: block;
			min-height: 18px;
		}

		.pls-special {
			font-weight: 700;
		}

		.pls-opening {
			color: #163b65;
		}

		.pls-total {
			color: #8a5200;
		}

		.pls-closing {
			color: #0f5132;
		}

		.pls-subtype {
			font-weight: 500;
			color: #4b5563;
		}

		.pls-balance {
			font-weight: 600;
			text-align: right;
		}

		.pls-balance-opening {
			color: #163b65;
		}

		.pls-balance-total {
			color: #8a5200;
		}

		.pls-balance-closing {
			color: #0f5132;
		}

		.pls-amount-strong {
			font-weight: 700;
		}

		.query-report .dt-row-header,
		.query-report .dt-cell--col-0 {
			display: none !important;
		}

		.query-report .dt-scrollable {
			border-radius: 16px;
			overflow: hidden;
			border: 1px solid #e5e7eb;
		}

		.query-report .dt-cell__content {
			padding-top: 10px;
			padding-bottom: 10px;
			white-space: normal !important;
			line-height: 1.45;
			overflow: visible !important;
			text-overflow: unset !important;
		}

		.query-report .datatable .dt-cell {
			vertical-align: top;
			overflow: visible !important;
		}

		.query-report .datatable .dt-cell__content--col-remarks,
		.query-report .datatable .dt-cell__content[data-col-index] {
			overflow: visible !important;
		}

		.party-ledger-header {
			background: linear-gradient(135deg, #f8fbff 0%, #eef5ff 100%);
			border: 1px solid #dbe7f5;
			border-radius: 18px;
			padding: 22px 24px;
			margin-bottom: 16px;
		}

		.party-ledger-header__company {
			font-size: 20px;
			font-weight: 700;
			color: #102a43;
			margin-bottom: 4px;
		}

		.party-ledger-header__title {
			font-size: 15px;
			font-weight: 600;
			color: #1f3b5b;
			margin-bottom: 10px;
		}

		.party-ledger-header__meta {
			display: flex;
			flex-wrap: wrap;
			gap: 18px;
			font-size: 12px;
			color: #52667a;
			line-height: 1.6;
		}
	`;
	document.head.appendChild(style);
}
