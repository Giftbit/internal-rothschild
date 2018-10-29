const fs = require('fs');
const path = require('path');
const webpack = require('webpack');
const ZipPlugin = require('zip-webpack-plugin');

module.exports = function (env) {
    const lambdaFunctionDir = path.join(__dirname, 'src', 'lambdas');
    const functionsToBuild = env && env.fxn ? env.fxn.split(",") : fs.readdirSync(lambdaFunctionDir).filter(item => fs.lstatSync(path.join(lambdaFunctionDir, item)).isDirectory() && !item.match(/^\./));
    console.log(`Building ${functionsToBuild.join(", ")}`);

    return functionsToBuild
        .map(fxn => ({
            mode: 'production',
            context: path.resolve(__dirname),
            entry: path.join(lambdaFunctionDir, fxn, 'index.ts'),
            output: {
                path: path.join(__dirname, 'dist', fxn),
                filename: 'index.js',
                libraryTarget: 'commonjs2'
            },
            module: {
                rules: [
                    {
                        test: /\.js$/,
                        use: [
                            {
                                loader: 'babel-loader',
                                options: {
                                    presets: [['@babel/env', {targets: {node: '8.10'}}]],
                                    plugins: [],
                                    compact: false,
                                    babelrc: false
                                }
                            }
                        ]
                    },
                    {
                        test: /\.ts(x?)$/,
                        use: [
                            {
                                loader: 'babel-loader',
                                options: {
                                    presets: [['@babel/env', {targets: {node: '8.10'}}]],
                                    plugins: [],
                                    compact: false,
                                    babelrc: false
                                }
                            },
                            'ts-loader',
                            'import-glob-loader'    // enables globs in import statements
                        ]
                    },
                    {
                        test: /\.jpe?g$|\.gif$|\.png$|\.svg$|\.woff$|\.ttf$|\.wav$|\.mp3$/,
                        use: [
                            'file-loader'
                        ]
                    },
                    {
                        test: /\/V\d+__.*\.sql$/,
                        use: [
                            {
                                loader: 'file-loader',
                                options: {
                                    name: 'schema/[name].[ext]'
                                }
                            }
                        ]
                    }
                ]
            },
            resolve: {
                extensions: ['.ts', '.tsx', '.js']
            },
            optimization: {
                minimize: false,
                namedModules: true
            },
            plugins: [
                new webpack.DefinePlugin({"global.GENTLY": false}), // see https://github.com/felixge/node-formidable/issues/337 for why
                new ZipPlugin({
                    path: path.join(__dirname, 'dist', fxn),
                    pathPrefix: '',
                    filename: `${fxn}.zip`
                }),

                // Knex dialects we won't use.
                new webpack.IgnorePlugin(/mssql/, /\/knex\//),
                // new webpack.IgnorePlugin(/mysql/, /\/knex\//), // Referenced by mysql2, which we use.
                new webpack.IgnorePlugin(/oracle/, /\/knex\//),
                new webpack.IgnorePlugin(/oracledb/, /\/knex\//),
                new webpack.IgnorePlugin(/postgres/, /\/knex\//),
                new webpack.IgnorePlugin(/redshift/, /\/knex\//),
                new webpack.IgnorePlugin(/sqlite3/, /\/knex\//),
            ],
            target: 'node',
            externals: {
                // These modules are already installed on the Lambda instance.
                'aws-sdk': 'aws-sdk',
                'awslambda': 'awslambda',
                'dynamodb-doc': 'dynamodb-doc',
                'imagemagick': 'imagemagick',

                // Knex drivers we won't use.
                'mssql': 'mssql',
                'mysql': 'mysql',
                'oracle': 'oracle',
                'pg': 'pg',
                'sqlite3': 'sqlite3'
            },
            node: {
                // Allow these globals.
                __filename: false,
                __dirname: false
            },
            stats: 'errors-only',
            bail: true
        }));
};
