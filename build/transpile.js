// ---------------------------------------------------------------------------
// Usage: npm run transpile
// ---------------------------------------------------------------------------

"use strict";

const fs = require ('fs')
    , log = require ('ololog')
    , ansi = require ('ansicolor').nice
    , { unCamelCase, precisionConstants, safeString } = require ('ccxt/js/base/functions.js')
    , {
        createFolderRecursively,
        overwriteFile,
    } = require ('ccxt/build/fs.js')
    , errors = require ('ccxt/js/base/errors.js')
    , Transpiler = require ('ccxt/build/transpile.js')

// ============================================================================

class CCXTProTranspiler extends Transpiler {
    constructor () {
        super ()
        this.phpPreamble = this.phpPreamble.replace (/ccxt/g, "ccxtpro")
    }

    createPythonClass (className, baseClass, body, methods, async = false) {

        const pythonStandardLibraries = {
            'base64': 'base64',
            'hashlib': 'hashlib',
            'math': 'math',
            'json.loads': 'json',
        }

        const baseClasses = {
            'Exchange': 'base.exchange',
        }

        async = (async ? '.async_support' : '')

        const ccxtImports = [
            (baseClass.indexOf ('ccxt.') === 0) ?
                ('import ccxt' + async + ' as ccxt') :
                ('from ccxt' + async + '.' + safeString (baseClasses, baseClass, baseClass) + ' import ' + baseClass)
        ]

        let bodyAsString = body.join ("\n")

        let header = [
            "# -*- coding: utf-8 -*-\n",
            "# PLEASE DO NOT EDIT THIS FILE, IT IS GENERATED AND WILL BE OVERWRITTEN:",
            "# https://github.com/ccxt/ccxt/blob/master/CONTRIBUTING.md#how-to-contribute-code\n",
            "import ccxtpro",
            ... ccxtImports,
            // 'from ' + importFrom + ' import ' + baseClass,
            ... (bodyAsString.match (/basestring/) ? [
                "\n# -----------------------------------------------------------------------------\n",
                "try:",
                "    basestring  # Python 3",
                "except NameError:",
                "    basestring = str  # Python 2",
            ] : [])
        ]

        const libraries = []

        for (let library in pythonStandardLibraries) {
            const regex = new RegExp ("[^\\']" + library + "[^\\'a-zA-Z]")
            if (bodyAsString.match (regex))
                libraries.push ('import ' + pythonStandardLibraries[library])
        }

        const errorImports = []

        for (const error in errors) {
            const regex = new RegExp ("[^\\'\"]" + error + "[^\\'\"]")
            if (bodyAsString.match (regex))
                errorImports.push ('from ccxt.base.errors import ' + error)
        }

        const precisionImports = []

        for (const constant in precisionConstants) {
            if (bodyAsString.indexOf (constant) >= 0) {
                precisionImports.push ('from ccxt.base.decimal_to_precision import ' + constant)
            }
        }

        header = header.concat (libraries, errorImports, precisionImports)

        for (const method of methods) {
            const regex = new RegExp ('self\\.(' + method + ')\\s*\\(', 'g')
            bodyAsString = bodyAsString.replace (regex,
                (match, p1) => ('self.' + unCamelCase (p1) + '('))
        }

        header.push ("\n\nclass " + className + '(' + [ 'ccxtpro.Exchange', baseClass ].join (', ') + '):')

        const footer = [
            '', // footer (last empty line)
        ]

        const result = header.join ("\n") + "\n" + bodyAsString + "\n" + footer.join ('\n')
        return result
    }

    createPHPClass (className, baseClass, body, methods) {

        const header = [
            "<?php",
            "",
            "namespace ccxtpro;",
            "",
            "// PLEASE DO NOT EDIT THIS FILE, IT IS GENERATED AND WILL BE OVERWRITTEN:",
            "// https://github.com/ccxt/ccxt/blob/master/CONTRIBUTING.md#how-to-contribute-code",
            "",
            "use Exception; // a common import",
            'use \\ccxt\\WebSocketTrait; // websocket functionality',
            "",
            'class ' + className + ' extends ' + baseClass.replace ('ccxt.', '\\ccxt\\') + ' {',
            "",
            "    use WebSocketTrait;",
        ]

        let bodyAsString = body.join ("\n")

        for (let method of methods) {
            const regex = new RegExp ('this->(' + method + ')\\s*\\(', 'g')
            bodyAsString = bodyAsString.replace (regex,
                (match, p1) => ('this->' + unCamelCase (p1) + ' ('))
        }

        const footer =[
            "}\n",
        ]

        const result = header.join ("\n") + "\n" + bodyAsString + "\n" + footer.join ('\n')
        return result
    }

    // ------------------------------------------------------------------------

    transpileOrderBookTest () {
        const jsFile = './js/test/base/test.OrderBook.js'
        const pyFile = './python/test/test_order_book.py'
        const phpFile = './php/test/OrderBook.php'

        log.magenta ('Transpiling from', jsFile.yellow)
        let js = fs.readFileSync (jsFile).toString ()

        js = this.regexAll (js, [
            [ /\'use strict\';?\s+/g, '' ],
            [ /[^\n]+require[^\n]+\n/g, '' ],
            [ /function equals \([\S\s]+?return true\n}\n/g, '' ],
        ])

        let { python3Body, python2Body, phpBody } = this.transpileJavaScriptToPythonAndPHP ({ js, removeEmptyLines: false })

        const pythonHeader = [
            "",
            "from ccxtpro.base.order_book import OrderBook, LimitedOrderBook, IndexedOrderBook, CountedOrderBook, IncrementalOrderBook, LimitedIndexedOrderBook  # noqa: F402",
            "",
            "",
            "def equals(a, b):",
            "    return a == b",
            "",
        ].join ("\n")

        const phpHeader = [
            "",
            "function equals($a, $b) {",
            "    return json_encode($a) === json_encode($b);",
            "}",
        ].join ("\n")

        const python = this.pyPreamble + pythonHeader + python2Body
        const php = this.phpPreamble + phpHeader + phpBody

        log.magenta ('→', pyFile.yellow)
        log.magenta ('→', phpFile.yellow)

        overwriteFile (pyFile, python)
        overwriteFile (phpFile, php)
    }

    // ------------------------------------------------------------------------

    transpileEverything () {

        // default pattern is '.js'
        const [ /* node */, /* script */, pattern ] = process.argv
            // , python2Folder = './python/ccxtpro/', // CCXT Pro does not support Python 2
            , python3Folder = './python/ccxtpro/'
            , phpFolder     = './php/'
            , options = { /* python2Folder, */ python3Folder, phpFolder }

        // createFolderRecursively (python2Folder)
        createFolderRecursively (python3Folder)
        createFolderRecursively (phpFolder)

        this.transpileOrderBookTest ()
        const classes = this.transpileDerivedExchangeFiles ('./js/', options, pattern)

        if (classes === null) {
            log.bright.yellow ('0 files transpiled.')
            return;
        }

        // HINT: if we're going to support specific class definitions
        // this process won't work anymore as it will override the definitions
        // exportTypeScriptDeclarations (classes)

        // transpileErrorHierarchy ()

        // transpilePrecisionTests ()
        // transpileDateTimeTests ()
        // transpileCryptoTests ()

        // transpilePythonAsyncToSync ('./python/test/test_async.py', './python/test/test.py')

        log.bright.green ('Transpiled successfully.')
    }
}

// ============================================================================
// main entry point

if (require.main === module) {

    // if called directly like `node module`
    const transpiler = new CCXTProTranspiler ()
    transpiler.transpileEverything ()

} else {

    // do nothing if required as a module
}

// ============================================================================

module.exports = {}
